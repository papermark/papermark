import { useRouter } from "next/router";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { useTeam } from "@/context/team-context";
import { useUploadProgress } from "@/context/upload-progress-context";
import { DocumentStorageType } from "@prisma/client";
import { useSession } from "next-auth/react";
import { DropEvent, FileRejection, useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { mutate } from "swr";

import { useAnalytics } from "@/lib/analytics";
import {
  FREE_PLAN_ACCEPTED_FILE_TYPES,
  FULL_PLAN_ACCEPTED_FILE_TYPES,
  HTML_ACCEPTED_FILE_TYPES,
  SUPPORTED_DOCUMENT_MIME_TYPES,
} from "@/lib/constants";
import { DocumentData, createDocument } from "@/lib/documents/create-document";
import {
  MULTIPART_SIZE_THRESHOLD,
  multipartUpload,
} from "@/lib/files/multipart-upload";
import { resumableUpload } from "@/lib/files/tus-upload";
import {
  BulkFolderRequestItem,
  BulkFolderResultItem,
  bulkCreateFoldersChunked,
  createFolderInMainDocs,
  isSystemFile,
} from "@/lib/folders/create-folder";
import { useFeatureFlags } from "@/lib/hooks/use-feature-flags";
import { usePlan } from "@/lib/swr/use-billing";
import useLimits from "@/lib/swr/use-limits";
import { useTeamSettings } from "@/lib/swr/use-team-settings";
import { CustomUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  getSupportedContentType,
  isHtmlFile,
} from "@/lib/utils/get-content-type";
import {
  getFileSizeLimit,
  getFileSizeLimits,
} from "@/lib/utils/get-file-size-limits";
import { getPagesCount } from "@/lib/utils/get-page-number-count";

// These mime values are kept out of useDropzone's `accept` to keep the file
// type fallback path in getFilesFromEvent reachable (some browsers, notably
// Firefox, can't detect MIME type for files yielded from a dropped folder and
// need this lookup table to fix it up).
const acceptableDropZoneMimeTypesWhenIsFreePlanAndNotTrial =
  FREE_PLAN_ACCEPTED_FILE_TYPES;
const allAcceptableDropZoneMimeTypes = FULL_PLAN_ACCEPTED_FILE_TYPES;

interface FileWithPaths extends File {
  path?: string;
  whereToUploadPath?: string;
  dataroomUploadPath?: string;
  /** Name of the top-level drag item this file belongs to */
  topLevelItemName?: string;
  topLevelItemIsFolder?: boolean;
  /** Number of folders created during traversal for this top-level item */
  topLevelItemFolderCount?: number;
  /** Server-generated slug path for the top-level folder (e.g. "folder-with-100-subfolders") */
  topLevelItemFolderPath?: string;
  /** Database id of the top-level folder in the dataroom (only set in dataroom uploads) */
  topLevelDataroomFolderId?: string;
}

export interface RejectedFile {
  fileName: string;
  message: string;
  reason?: "error" | "plan-limit" | "max-files" | "file-type";
  /** Individual file paths skipped due to limits — used for downloadable list */
  skippedFileNames?: string[];
}

export interface UploadItemState {
  itemId: string;
  name: string;
  type: "folder" | "file";
  /** Total entries: all nested folders + all files for folders; 1 for loose files */
  totalEntries: number;
  completedEntries: number;
  failedEntries: number;
  cancelled?: boolean;
  /** Pre-computed link for completed folder items */
  folderHref?: string;
  /** Byte-level upload progress for granular tracking (especially single large files) */
  bytesUploaded?: number;
  bytesTotal?: number;
}

export interface UploadBatchState {
  batchId: string;
  items: UploadItemState[];
  startedAt: number;
  /** Total entries across all items (folders + files) */
  totalEntries: number;
  completedEntries: number;
  failedEntries: number;
  cancelled?: boolean;
  /** Aggregate byte-level progress across all items */
  bytesUploaded?: number;
  bytesTotal?: number;
}

const UPLOAD_CONCURRENCY = 5;

/**
 * Window during which per-file SWR mutate keys are coalesced. The upload
 * loop fires up to 4 mutates per completed file; without batching, 400 files
 * produces 1600 GET refetches that re-fetch unpaginated folder trees and
 * saturate the per-origin connection pool. With a small debounce window
 * each unique key fires at most once per window, regardless of how many
 * files completed in that interval.
 */
const MUTATE_FLUSH_INTERVAL_MS = 500;

async function processWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

/** Coalesces SWR mutate calls by key, flushing on a fixed interval + on demand. */
function createMutateQueue(intervalMs: number) {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) return;
    const keys = Array.from(pending);
    pending.clear();
    for (const key of keys) mutate(key);
  };

  return {
    enqueue(key: string | undefined | null | false) {
      if (!key) return;
      pending.add(key);
      if (!timer) timer = setTimeout(flush, intervalMs);
    },
    flush,
  };
}

function stripLeadingSlash(p: string | null | undefined): string | undefined {
  if (!p) return undefined;
  return p.startsWith("/") ? p.slice(1) : p;
}

/**
 * Attempts to repair the MIME type of a `File` whose `type` was reported as
 * empty by the browser (Firefox does this for files yielded from a folder
 * picker). Looks up the file extension against the supplied accept map; if a
 * matching entry is found, returns a new `File` with the inferred MIME so
 * downstream size/plan checks and the eventual S3 upload all see the right
 * content type. Mirrors the inference the drag-drop walker already performs.
 */
function inferMimeFromExtensionMap(
  file: File,
  acceptable: Record<string, readonly string[]>,
): File {
  if (file.type) return file;
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext) return file;
  for (const [mime, extsUntyped] of Object.entries(acceptable)) {
    const exts = extsUntyped as readonly string[];
    if (exts.some((e) => e.toLowerCase() === "." + ext)) {
      return new File([file], file.name, {
        type: mime,
        lastModified: file.lastModified,
      });
    }
  }
  return file;
}

/**
 * Mirrors react-dropzone's `accept` filtering for the folder-picker code
 * path: a file is acceptable when its MIME matches a key in the accept map
 * OR its extension matches one of the value-side extensions. The folder
 * picker bypasses dropzone entirely, so without this gate a free-plan user
 * could pick a folder containing paid-only file types and start the upload
 * pipeline — bytes would land in S3 and only be rejected at document-
 * creation time, after the upload had already happened.
 */
function isAcceptableForPlan(
  file: File,
  acceptable: Record<string, readonly string[]>,
): boolean {
  if (file.type && file.type in acceptable) return true;
  const lowerName = file.name.toLowerCase();
  const dotExt = "." + (lowerName.split(".").pop() ?? "");
  for (const exts of Object.values(acceptable)) {
    for (const e of exts as readonly string[]) {
      if (e.toLowerCase() === dotExt) return true;
    }
  }
  return false;
}

/**
 * Parent path (without leading slash) of a folder path expressed in the
 * client-side "no leading slash" format. Returns undefined when the parent is
 * the root (i.e. the path is empty, "/", or a single top-level segment) —
 * callers should fall back to the `?root=true` key in that case.
 */
function parentPathOf(p: string | null | undefined): string | undefined {
  if (!p) return undefined;
  const segments = p.split("/").filter(Boolean);
  if (segments.length <= 1) return undefined;
  return segments.slice(0, -1).join("/");
}

export interface UploadedTopLevelFolder {
  /** Database id of the dataroom folder */
  dataroomFolderId: string;
  /** Folder name shown to the user */
  name: string;
}

interface UploadZoneProps extends React.PropsWithChildren {
  onUploadBatchStart: (batch: UploadBatchState, cancelFn: () => void) => void;
  onUploadBatchUpdate: (batchId: string, update: Partial<UploadBatchState>) => void;
  onUploadRejected: (rejected: RejectedFile[]) => void;
  onUploadSuccess?: (
    files: {
      fileName: string;
      documentId: string;
      dataroomDocumentId: string;
      /** Set when this file was uploaded as part of a top-level dataroom folder */
      topLevelDataroomFolderId?: string;
    }[],
    folders?: UploadedTopLevelFolder[],
  ) => void;
  onTraversalStart?: (
    preliminaryItems?: { name: string; isFolder: boolean }[],
  ) => void;
  onUploadAborted?: () => void;
  setRejectedFiles: React.Dispatch<React.SetStateAction<RejectedFile[]>>;
  cancelledItemIdsRef?: React.RefObject<Set<string>>;
  folderPathName?: string;
  dataroomId?: string;
  dataroomName?: string;
  disabled?: boolean;
}

export default function UploadZone({
  children,
  onUploadBatchStart,
  onUploadBatchUpdate,
  onUploadRejected,
  onUploadSuccess,
  onTraversalStart,
  onUploadAborted,
  folderPathName,
  setRejectedFiles,
  cancelledItemIdsRef,
  dataroomId,
  dataroomName,
  disabled = false,
}: UploadZoneProps) {
  const analytics = useAnalytics();
  const { plan, isFree, isTrial } = usePlan();
  const router = useRouter();
  const teamInfo = useTeam();
  const { data: session } = useSession();
  const { limits, canAddDocuments, isPaused } = useLimits();
  const { registerUploadTriggers } = useUploadProgress();
  const { isFeatureEnabled } = useFeatureFlags();
  const htmlDocumentsEnabled = isFeatureEnabled("htmlDocuments");

  // Refs to the two hidden file inputs rendered inside this zone. Used to
  // open the OS picker without traversing the DOM by id, so callers
  // (e.g. AddDocumentDropdown) can trigger uploads through context rather
  // than reaching across scopes.
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const hasDocumentLimit = limits?.documents != null && limits.documents > 0;
  const remainingDocuments = hasDocumentLimit
    ? limits.documents - (limits?.usage?.documents ?? 0)
    : Infinity;

  // Fetch team settings with proper revalidation - ensures settings stay fresh across tabs
  const { settings: teamSettings } = useTeamSettings(teamInfo?.currentTeam?.id);
  const replicateDataroomFolders =
    teamSettings?.replicateDataroomFolders ?? true;

  // Track if we've created the dataroom folder in "All Documents" for non-replication mode
  // Using promise-lock pattern to prevent race conditions during concurrent folder creation
  const dataroomFolderPathRef = useRef<string | null>(null);
  const dataroomFolderCreationPromiseRef = useRef<Promise<string> | null>(null);
  const fileLimitTruncatedRef = useRef(false);

  // Reset the cached dataroom folder path when the replication setting changes
  // This ensures we don't use stale cached paths if the setting is toggled
  useEffect(() => {
    dataroomFolderPathRef.current = null;
    dataroomFolderCreationPromiseRef.current = null;
  }, [replicateDataroomFolders, dataroomId]);

  // Expose imperative picker triggers via context so the +Add dropdown
  // (rendered in the page toolbar, outside this zone) can open the
  // OS file picker without reaching into the DOM via `getElementById`.
  // While disabled, we deliberately don't register — callers will fall
  // back to their no-zone path (e.g. opening the single-file modal).
  useEffect(() => {
    if (disabled) return;
    return registerUploadTriggers({
      openFilesPicker: () => filesInputRef.current?.click(),
      openFolderPicker: () => folderInputRef.current?.click(),
    });
  }, [registerUploadTriggers, disabled]);

  const fileSizeLimits = useMemo(
    () =>
      getFileSizeLimits({
        limits,
        isFree,
        isTrial,
      }),
    [limits, isFree, isTrial],
  );

  const acceptableDropZoneFileTypes = useMemo(
    () =>
      isFree && !isTrial
        ? acceptableDropZoneMimeTypesWhenIsFreePlanAndNotTrial
        : {
            ...allAcceptableDropZoneMimeTypes,
            ...(htmlDocumentsEnabled ? HTML_ACCEPTED_FILE_TYPES : {}),
          },
    [isFree, isTrial, htmlDocumentsEnabled],
  );

  // Helper function to get or create the dataroom folder in "All Documents"
  // Uses promise-lock pattern to prevent concurrent creation attempts
  const getOrCreateDataroomFolder = useCallback(async (): Promise<string> => {
    // If we already have the path cached, return it immediately
    if (dataroomFolderPathRef.current) {
      return dataroomFolderPathRef.current;
    }

    // If there's an ongoing creation, await it
    if (dataroomFolderCreationPromiseRef.current) {
      return dataroomFolderCreationPromiseRef.current;
    }

    // Start a new creation process
    const creationPromise = (async () => {
      try {
        if (!teamInfo?.currentTeam?.id || !dataroomName) {
          throw new Error("Missing team ID or dataroom name");
        }

        // First check if the folder already exists
        const existingFoldersResponse = await fetch(
          `/api/teams/${teamInfo.currentTeam.id}/folders?root=true`,
        );

        if (existingFoldersResponse.ok) {
          const existingFolders = await existingFoldersResponse.json();
          const existingDataroomFolder = existingFolders.find(
            (folder: any) => folder.name === dataroomName,
          );

          if (existingDataroomFolder) {
            // Folder already exists, use it
            const folderPath = existingDataroomFolder.path.startsWith("/")
              ? existingDataroomFolder.path.slice(1)
              : existingDataroomFolder.path;
            dataroomFolderPathRef.current = folderPath;
            return folderPath;
          }
        }

        // Folder doesn't exist, create it
        const dataroomFolderResponse = await createFolderInMainDocs({
          teamId: teamInfo.currentTeam.id,
          name: dataroomName,
          path: undefined, // Create at root level
        });

        const folderPath = dataroomFolderResponse.path.startsWith("/")
          ? dataroomFolderResponse.path.slice(1)
          : dataroomFolderResponse.path;

        dataroomFolderPathRef.current = folderPath;

        analytics.capture("Dataroom Folder Created in Main Docs", {
          folderName: dataroomName,
          dataroomId,
        });

        return folderPath;
      } catch (error) {
        console.error("Error handling dataroom folder:", error);
        // Clear the promise ref on error so subsequent attempts can retry
        dataroomFolderCreationPromiseRef.current = null;
        // Use dataroom name as fallback path
        const fallbackPath = dataroomName || "";
        dataroomFolderPathRef.current = fallbackPath;
        return fallbackPath;
      } finally {
        // Clear the promise ref once creation is complete
        dataroomFolderCreationPromiseRef.current = null;
      }
    })();

    // Store the promise so concurrent callers can await it
    dataroomFolderCreationPromiseRef.current = creationPromise;
    return creationPromise;
  }, [teamInfo, dataroomName, dataroomId, analytics]);

  // this var will help to determine the correct api endpoint to request folder creation (If needed).
  const endpointTargetType = dataroomId
    ? `datarooms/${dataroomId}/folders`
    : "folders";

  // Shared bulk-folder-create helper used by both the drag-drop walker and the
  // `<input webkitdirectory>` picker. Performs the same API calls, analytics,
  // and SWR cache invalidation regardless of how the folder list was sourced.
  const createFoldersForUpload = useCallback(
    async (
      allFolders: BulkFolderRequestItem[],
    ): Promise<{
      dataroomByTemp: Map<string, BulkFolderResultItem>;
      mainDocsByTemp: Map<string, BulkFolderResultItem>;
      dataroomFolderInMainDocsPath?: string;
    } | null> => {
      let dataroomByTemp = new Map<string, BulkFolderResultItem>();
      let mainDocsByTemp = new Map<string, BulkFolderResultItem>();
      let dataroomFolderInMainDocsPath: string | undefined;

      const teamId = teamInfo?.currentTeam?.id;
      if (!teamId) {
        setRejectedFiles((prev) => [
          { fileName: "Unknown Team", message: "Team Id not found" },
          ...prev,
        ]);
        return null;
      }

      const rootPathForApi =
        folderPathName && folderPathName.length > 0
          ? "/" + folderPathName
          : "/";

      if (allFolders.length === 0) {
        if (!replicateDataroomFolders && dataroomId && dataroomName) {
          dataroomFolderInMainDocsPath = await getOrCreateDataroomFolder();
        }
        return {
          dataroomByTemp,
          mainDocsByTemp,
          dataroomFolderInMainDocsPath,
        };
      }

      try {
        if (dataroomId) {
          // Replicated copies in main docs always live at the team root,
          // regardless of where in the dataroom the user dropped the tree.
          const tasks: Promise<void>[] = [
            bulkCreateFoldersChunked({
              url: `/api/teams/${teamId}/datarooms/${dataroomId}/folders/bulk`,
              rootPath: rootPathForApi,
              folders: allFolders,
            }).then((rows) => {
              dataroomByTemp = new Map(rows.map((r) => [r.tempId, r]));
            }),
          ];
          if (replicateDataroomFolders) {
            tasks.push(
              bulkCreateFoldersChunked({
                url: `/api/teams/${teamId}/folders/bulk`,
                rootPath: "/",
                folders: allFolders,
              }).then((rows) => {
                mainDocsByTemp = new Map(rows.map((r) => [r.tempId, r]));
              }),
            );
          } else if (dataroomName) {
            dataroomFolderInMainDocsPath = await getOrCreateDataroomFolder();
          }
          await Promise.all(tasks);
        } else {
          const rows = await bulkCreateFoldersChunked({
            url: `/api/teams/${teamId}/folders/bulk`,
            rootPath: rootPathForApi,
            folders: allFolders,
          });
          mainDocsByTemp = new Map(rows.map((r) => [r.tempId, r]));
        }

        analytics.capture("Folder Added (bulk)", {
          count: allFolders.length,
          dataroomId: dataroomId,
          replicated: dataroomId ? replicateDataroomFolders : undefined,
        });

        // Broad one-shot revalidation of every cached folder/document key
        // for this scope. See the original drag-drop branch for a longer
        // rationale — this short-circuits the SWR cache staleness that
        // otherwise lingers for deep paths after a bulk create.
        const isDataroomFolderKey = (key: unknown) =>
          typeof key === "string" &&
          dataroomId !== undefined &&
          (key.startsWith(
            `/api/teams/${teamId}/datarooms/${dataroomId}/folders`,
          ) ||
            key.startsWith(
              `/api/teams/${teamId}/datarooms/${dataroomId}/folder-documents`,
            ) ||
            key.startsWith(
              `/api/teams/${teamId}/datarooms/${dataroomId}/documents`,
            ));
        const isMainDocsFolderKey = (key: unknown) =>
          typeof key === "string" &&
          (key.startsWith(`/api/teams/${teamId}/folders`) ||
            key.startsWith(`/api/teams/${teamId}/folder-documents`) ||
            key === `/api/teams/${teamId}/documents`);

        if (dataroomId) {
          mutate(isDataroomFolderKey);
          if (replicateDataroomFolders) mutate(isMainDocsFolderKey);
        } else {
          mutate(isMainDocsFolderKey);
        }

        if (!replicateDataroomFolders && dataroomId && dataroomName) {
          dataroomFolderInMainDocsPath = await getOrCreateDataroomFolder();
        }

        return {
          dataroomByTemp,
          mainDocsByTemp,
          dataroomFolderInMainDocsPath,
        };
      } catch (error) {
        console.error("Bulk folder creation failed:", error);
        setRejectedFiles((prev) => [
          ...allFolders.map((f) => ({
            fileName: f.name,
            message: "Failed to create the folder",
          })),
          ...prev,
        ]);
        return null;
      }
    },
    [
      teamInfo,
      folderPathName,
      dataroomId,
      dataroomName,
      replicateDataroomFolders,
      getOrCreateDataroomFolder,
      analytics,
      setRejectedFiles,
    ],
  );

  const onDropRejected = useCallback(
    (rejectedFiles: FileRejection[]) => {
      const hasTooManyFiles = rejectedFiles.some(({ errors }) =>
        errors.some(({ code }) => code === "too-many-files"),
      );

      if (hasTooManyFiles) {
        const maxFiles = fileSizeLimits.maxFiles ?? 150;
        toast.error(
          `You're trying to upload ${rejectedFiles.length} files, but you can only upload up to ${maxFiles} files at once. Please upload in smaller batches.`,
          { duration: 8000 },
        );
        onUploadRejected([
          {
            fileName: `${rejectedFiles.length} files selected`,
            message: `Maximum ${maxFiles} files per upload`,
            reason: "max-files",
          },
        ]);
        return;
      }

      const rejected = rejectedFiles.map<RejectedFile>(({ file, errors }) => {
        let message = "";
        let reason: RejectedFile["reason"] = "error";
        if (errors.find(({ code }) => code === "file-too-large")) {
          const fileSizeLimitMB = getFileSizeLimit(file.type, fileSizeLimits);
          message = `File size too big (max. ${fileSizeLimitMB} MB). Upgrade to a paid plan to increase the limit.`;
        } else if (errors.find(({ code }) => code === "file-invalid-type")) {
          const isSupported = SUPPORTED_DOCUMENT_MIME_TYPES.includes(file.type);
          // Supported on a paid plan but blocked on free → upgrading helps.
          // Otherwise the type is simply unsupported and upgrading won't help.
          const isPlanLimited = isFree && !isTrial && isSupported;
          message = `File type not supported${isPlanLimited ? " on free plan" : ""}`;
          reason = isPlanLimited ? "plan-limit" : "file-type";
        }
        return { fileName: file.name, message, reason };
      });
      onUploadRejected(rejected);
    },
    [onUploadRejected, fileSizeLimits, isFree, isTrial],
  );

  const onDrop = useCallback(
    async (acceptedFiles: FileWithPaths[]) => {
      if (isPaused) {
        toast.error(
          "Your subscription is paused. Resume your subscription to upload documents.",
          {
            action: {
              label: "Go to Billing",
              onClick: () => router.push("/settings/billing"),
            },
          },
        );
        onUploadAborted?.();
        return;
      }

      if (hasDocumentLimit && remainingDocuments <= 0) {
        toast.error(
          `You've reached your plan's document limit (${limits?.usage?.documents}/${limits?.documents} documents). Upgrade your plan to upload more.`,
          {
            action: {
              label: "Upgrade",
              onClick: () => router.push("/settings/billing"),
            },
            duration: 8000,
          },
        );
        onUploadAborted?.();
        return;
      }

      let filesToUpload = acceptedFiles;

      if (fileLimitTruncatedRef.current) {
        fileLimitTruncatedRef.current = false;
        toast.warning(
          `Your upload was limited to ${acceptedFiles.length} file${acceptedFiles.length === 1 ? "" : "s"} because your plan only allows ${remainingDocuments} more document${remainingDocuments === 1 ? "" : "s"} (${limits?.usage?.documents}/${limits?.documents} used).`,
          {
            action: {
              label: "Upgrade",
              onClick: () => router.push("/settings/billing"),
            },
            duration: 10000,
          },
        );
      } else if (hasDocumentLimit && acceptedFiles.length > remainingDocuments) {
        const skippedCount = acceptedFiles.length - remainingDocuments;
        toast.warning(
          `You're trying to upload ${acceptedFiles.length} files, but your plan only allows ${remainingDocuments} more document${remainingDocuments === 1 ? "" : "s"} (${limits?.usage?.documents}/${limits?.documents} used). ${skippedCount} file${skippedCount === 1 ? "" : "s"} will be skipped.`,
          {
            action: {
              label: "Upgrade",
              onClick: () => router.push("/settings/billing"),
            },
            duration: 10000,
          },
        );
        filesToUpload = acceptedFiles.slice(0, remainingDocuments);
        const skippedFiles = acceptedFiles.slice(remainingDocuments);
        setRejectedFiles((prev) => [
          ...skippedFiles.map((f) => ({
            fileName: f.name,
            message: "Document limit reached",
            reason: "plan-limit" as const,
          })),
          ...prev,
        ]);
      }

      const validatedFiles = filesToUpload.reduce<{
        valid: FileWithPaths[];
        invalid: { fileName: string; message: string }[];
      }>(
        (acc, file) => {
          const fileSizeLimitMB = getFileSizeLimit(file.type, fileSizeLimits);
          const fileSizeLimit = fileSizeLimitMB * 1024 * 1024;

          if (file.size > fileSizeLimit) {
            acc.invalid.push({
              fileName: file.name,
              message: `File size too big (max. ${fileSizeLimitMB} MB)${
                isFree && !isTrial
                  ? ". Upgrade to a paid plan to increase the limit"
                  : ""
              }`,
            });
          } else {
            acc.valid.push(file);
          }
          return acc;
        },
        { valid: [], invalid: [] },
      );

      if (validatedFiles.invalid.length > 0) {
        setRejectedFiles((prev) => [...validatedFiles.invalid, ...prev]);

        if (validatedFiles.valid.length === 0) {
          toast.error(
            `${validatedFiles.invalid.length} file(s) exceeded size limits`,
          );
          onUploadAborted?.();
          return;
        }
      }

      // Group files by their top-level drag item
      const itemGroups = new Map<
        string,
        {
          name: string;
          isFolder: boolean;
          folderCount: number;
          folderSlugPath?: string;
          dataroomFolderId?: string;
          files: FileWithPaths[];
        }
      >();
      for (const file of validatedFiles.valid) {
        const key = file.topLevelItemName ?? file.name;
        const existing = itemGroups.get(key);
        if (existing) {
          existing.files.push(file);
        } else {
          itemGroups.set(key, {
            name: key,
            isFolder: file.topLevelItemIsFolder ?? false,
            folderCount: file.topLevelItemFolderCount ?? 0,
            folderSlugPath: file.topLevelItemFolderPath,
            dataroomFolderId: file.topLevelDataroomFolderId,
            files: [file],
          });
        }
      }

      const batchId = crypto.randomUUID();
      let totalEntriesAcrossAll = 0;

      const items: UploadItemState[] = Array.from(itemGroups.values()).map(
        (group) => {
          const folderCount = group.isFolder ? group.folderCount : 0;
          const total = folderCount + group.files.length;
          totalEntriesAcrossAll += total;

          let folderHref: string | undefined;
          if (group.isFolder && group.folderSlugPath) {
            folderHref = dataroomId
              ? `/datarooms/${dataroomId}/documents/${group.folderSlugPath}`
              : `/documents/tree/${group.folderSlugPath}`;
          }

          const groupBytesTotal = group.files.reduce((sum, f) => sum + f.size, 0);

          return {
            itemId: crypto.randomUUID(),
            name: group.name,
            type: group.isFolder ? ("folder" as const) : ("file" as const),
            totalEntries: total,
            completedEntries: folderCount,
            failedEntries: 0,
            folderHref,
            bytesUploaded: 0,
            bytesTotal: groupBytesTotal,
          };
        },
      );

      const batch: UploadBatchState = {
        batchId,
        items,
        startedAt: Date.now(),
        totalEntries: totalEntriesAcrossAll,
        // Folders created during traversal count as completed entries
        completedEntries: items.reduce((s, it) => s + it.completedEntries, 0),
        failedEntries: 0,
        bytesUploaded: 0,
        bytesTotal: items.reduce((s, it) => s + (it.bytesTotal ?? 0), 0),
      };

      const dropCancelled = { current: false };
      onUploadBatchStart(batch, () => {
        dropCancelled.current = true;
      });

      // Build a lookup: file -> which UploadItemState it belongs to
      const fileToItem = new Map<FileWithPaths, UploadItemState>();
      let itemIdx = 0;
      for (const group of itemGroups.values()) {
        const item = items[itemIdx++];
        for (const file of group.files) {
          fileToItem.set(file, item);
        }
      }

      let completedCount = batch.completedEntries;
      let failedCount = 0;

      // Per-file byte tracking for granular progress
      const fileBytesUploaded = new Map<FileWithPaths, number>();
      const itemFilesMap = new Map<UploadItemState, FileWithPaths[]>();
      for (const [file, item] of fileToItem) {
        fileBytesUploaded.set(file, 0);
        const files = itemFilesMap.get(item) ?? [];
        files.push(file);
        itemFilesMap.set(item, files);
      }

      const emitUpdate = () => {
        onUploadBatchUpdate(batchId, {
          items: items.map((it) => {
            const filesInItem = itemFilesMap.get(it) ?? [];
            let uploaded = 0;
            for (const f of filesInItem) {
              uploaded += fileBytesUploaded.get(f) ?? 0;
            }
            return { ...it, bytesUploaded: uploaded };
          }),
          completedEntries: completedCount,
          failedEntries: failedCount,
        });
      };

      const mutateQueue = createMutateQueue(MUTATE_FLUSH_INTERVAL_MS);

      const uploadTasks = validatedFiles.valid.map((file) => async () => {
        if (dropCancelled.current) return undefined;

        const path = file.path || file.name;
        const parentItem = fileToItem.get(file)!;

        // Skip files for cancelled items
        if (cancelledItemIdsRef?.current?.has(parentItem.itemId)) {
          return undefined;
        }

        try {
          let numPages = 1;
          if (file.type === "application/pdf") {
            const buffer = await file.arrayBuffer();
            numPages = await getPagesCount(buffer);

            if (numPages > fileSizeLimits.maxPages) {
              failedCount++;
              parentItem.failedEntries++;
              setRejectedFiles((prev) => [
                {
                  fileName: file.name,
                  message: `File has too many pages (max. ${fileSizeLimits.maxPages})`,
                },
                ...prev,
              ]);
              emitUpdate();
              return undefined;
            }
          }

          // Files above the multipart threshold bypass the TUS Vercel
          // function and PUT directly to S3 using pre-signed part URLs. TUS
          // is still preferred for smaller files: each chunk is bounded by
          // the function's `maxDuration`, but TUS's resumable behavior is
          // valuable on flaky networks for the medium-file long tail.
          const useMultipart =
            process.env.NEXT_PUBLIC_UPLOAD_TRANSPORT === "s3" &&
            file.size > MULTIPART_SIZE_THRESHOLD;

          let storageKey: string;
          let storageFileName: string;
          let storageFileType: string;
          let storageNumPages: number;

          if (useMultipart) {
            const result = await multipartUpload({
              file,
              teamId: teamInfo?.currentTeam?.id as string,
              numPages,
              contentType: file.type,
              onProgress: (bytesUploaded) => {
                fileBytesUploaded.set(file, bytesUploaded);
                emitUpdate();
              },
            });
            storageKey = result.key;
            storageFileName = result.fileName;
            storageFileType = result.fileType;
            storageNumPages = result.numPages;
          } else {
            const { complete } = await resumableUpload({
              file,
              onProgress: (bytesUploaded, _bytesTotal) => {
                fileBytesUploaded.set(file, bytesUploaded);
                emitUpdate();
              },
              onError: () => {
                failedCount++;
                parentItem.failedEntries++;
                setRejectedFiles((prev) => [
                  { fileName: file.name, message: "Error uploading file" },
                  ...prev,
                ]);
                emitUpdate();
              },
              ownerId: (session?.user as CustomUser).id,
              teamId: teamInfo?.currentTeam?.id as string,
              numPages,
              relativePath: path.substring(0, path.lastIndexOf("/")),
            });

            const uploadResult = await complete;
            storageKey = uploadResult.id;
            storageFileName = uploadResult.fileName;
            storageFileType = uploadResult.fileType;
            storageNumPages = uploadResult.numPages;
          }

          let contentType = storageFileType;
          let supportedFileType = getSupportedContentType(contentType) ?? "";

          if (
            storageFileName.toLowerCase().endsWith(".md") ||
            storageFileName.toLowerCase().endsWith(".markdown")
          ) {
            supportedFileType = "docs";
            contentType = "text/markdown";
          }

          if (
            storageFileName.endsWith(".dwg") ||
            storageFileName.endsWith(".dxf")
          ) {
            supportedFileType = "cad";
            contentType = `image/vnd.${storageFileName.split(".").pop()}`;
          }

          if (storageFileName.endsWith(".xlsm")) {
            supportedFileType = "sheet";
            contentType = "application/vnd.ms-excel.sheet.macroEnabled.12";
          }

          if (
            storageFileName.endsWith(".kml") ||
            storageFileName.endsWith(".kmz")
          ) {
            supportedFileType = "map";
            contentType = `application/vnd.google-earth.${storageFileName.endsWith(".kml") ? "kml+xml" : "kmz"}`;
          }

          if (
            storageFileName.endsWith(".tif") ||
            storageFileName.endsWith(".tiff")
          ) {
            supportedFileType = "other";
            contentType = "image/tiff";
          }

          if (storageFileName.endsWith(".ecw")) {
            supportedFileType = "other";
            contentType = "image/x-ecw";
          }

          if (storageFileName.endsWith(".bak")) {
            supportedFileType = "other";
            contentType = "application/x-bak";
          }

          if (isHtmlFile({ name: storageFileName, contentType })) {
            supportedFileType = "html";
            contentType = "text/html";
          }

          const documentData: DocumentData = {
            key: storageKey,
            supportedFileType: supportedFileType,
            name: file.name,
            storageType: DocumentStorageType.S3_PATH,
            contentType: contentType,
            fileSize: file.size,
          };

          const fileUploadPathName = file?.whereToUploadPath;
          const dataroomUploadPathName = file?.dataroomUploadPath;

          const response = await createDocument({
            documentData,
            teamId: teamInfo?.currentTeam?.id as string,
            numPages: storageNumPages,
            folderPathName: fileUploadPathName,
          });

          mutateQueue.enqueue(
            `/api/teams/${teamInfo?.currentTeam?.id}/documents`,
          );
          mutateQueue.enqueue(
            fileUploadPathName &&
              `/api/teams/${teamInfo?.currentTeam?.id}/folder-documents/${fileUploadPathName}`,
          );
          // Refresh folder-list keys so per-folder `_count.documents` updates
          // while the upload is in progress: root (always), the user's
          // current view, and the parent of the folder this specific file
          // lands in (so a subfolder card the user is viewing ticks up). The
          // queue dedupes by key + flushes on a debounce window, so this is
          // bounded to ~one refresh per 500 ms regardless of file count.
          mutateQueue.enqueue(
            `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}?root=true`,
          );
          mutateQueue.enqueue(
            folderPathName &&
              `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}/${folderPathName}`,
          );
          const fileParentPath = parentPathOf(fileUploadPathName);
          mutateQueue.enqueue(
            fileParentPath &&
              `/api/teams/${teamInfo?.currentTeam?.id}/folders/${fileParentPath}`,
          );

          const document = await response.json();
          let dataroomResponse;
          if (dataroomId) {
            try {
              dataroomResponse = await fetch(
                `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/documents`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    documentId: document.id,
                    folderPathName: dataroomUploadPathName || fileUploadPathName,
                  }),
                },
              );

              if (!dataroomResponse?.ok) {
                const { message } = await dataroomResponse.json();
                console.error(
                  "An error occurred while adding document to the dataroom: ",
                  message,
                );
                return undefined;
              }

              mutateQueue.enqueue(
                `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/documents`,
              );
              mutateQueue.enqueue(
                (dataroomUploadPathName || fileUploadPathName) &&
                  `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/folder-documents/${dataroomUploadPathName || fileUploadPathName}`,
              );
              const dataroomParentPath = parentPathOf(
                dataroomUploadPathName || fileUploadPathName,
              );
              mutateQueue.enqueue(
                dataroomParentPath &&
                  `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/folders/${dataroomParentPath}`,
              );
            } catch (error) {
              console.error(
                "An error occurred while adding document to the dataroom: ",
                error,
              );
            }
          }

          completedCount++;
          parentItem.completedEntries++;
          fileBytesUploaded.set(file, file.size);
          if (!parentItem.folderHref && document.id) {
            parentItem.folderHref = `/documents/${document.id}`;
          }
          emitUpdate();

          analytics.capture("Document Added", {
            documentId: document.id,
            name: document.name,
            numPages: document.numPages,
            path: router.asPath,
            type: document.type,
            contentType: document.contentType,
            teamId: teamInfo?.currentTeam?.id,
            bulkupload: true,
            dataroomId: dataroomId,
            $set: {
              teamId: teamInfo?.currentTeam?.id,
              teamPlan: plan,
            },
          });
          const dataroomDocumentId = dataroomResponse?.ok
            ? (await dataroomResponse.json()).id
            : null;

          return {
            ...document,
            dataroomDocumentId: dataroomDocumentId,
            topLevelDataroomFolderId: file.topLevelDataroomFolderId,
            topLevelItemIsFolder: file.topLevelItemIsFolder,
          };
        } catch (error) {
          failedCount++;
          parentItem.failedEntries++;
          setRejectedFiles((prev) => [
            { fileName: file.name, message: "Error uploading file" },
            ...prev,
          ]);
          emitUpdate();
          return undefined;
        }
      });

      try {
        const results = await processWithConcurrency(uploadTasks, UPLOAD_CONCURRENCY);

        mutateQueue.enqueue(
          `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}?root=true`,
        );
        mutateQueue.enqueue(
          `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}`,
        );
        mutateQueue.enqueue(
          folderPathName &&
            `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}/${folderPathName}`,
        );

        // When a dataroom drop also replicates folders into "All Documents",
        // refresh the main-docs caches at end of batch. Single revalidation
        // covers what the now-removed per-folder mutate() calls used to do.
        if (dataroomId && replicateDataroomFolders) {
          mutateQueue.enqueue(
            `/api/teams/${teamInfo?.currentTeam?.id}/folders?root=true`,
          );
          mutateQueue.enqueue(
            `/api/teams/${teamInfo?.currentTeam?.id}/documents`,
          );
        }

        mutateQueue.flush();

        const uploadedDocuments = results.filter(Boolean);
        const dataroomDocuments = uploadedDocuments.map((document: any) => ({
          documentId: document.id,
          dataroomDocumentId: document.dataroomDocumentId,
          fileName: document.name,
          topLevelDataroomFolderId: document.topLevelDataroomFolderId,
        }));

        // Collect every top-level folder the user dropped so the caller can
        // offer one-shot folder-level permission configuration instead of
        // walking through every uploaded file individually.
        const uploadedFolders: UploadedTopLevelFolder[] = Array.from(
          itemGroups.values(),
        )
          .filter(
            (group) =>
              group.isFolder && !!group.dataroomFolderId,
          )
          .map((group) => ({
            dataroomFolderId: group.dataroomFolderId!,
            name: group.name,
          }));

        onUploadSuccess?.(dataroomDocuments, uploadedFolders);
      } catch (error) {
        console.error("Upload batch failed:", error);
      } finally {
        mutateQueue.flush();
      }
    },
    [
      onUploadBatchStart,
      onUploadBatchUpdate,
      onUploadAborted,
      endpointTargetType,
      fileSizeLimits,
      isFree,
      isTrial,
      isPaused,
      hasDocumentLimit,
      remainingDocuments,
      dataroomId,
      replicateDataroomFolders,
    ],
  );

  const getFilesFromEvent = useCallback(
    async (event: DropEvent) => {
      // useDropzone invokes getFilesFromEvent for dragenter too; only react to drop/change.
      if ("type" in event && event.type !== "drop" && event.type !== "change") {
        return [];
      }

      let preliminaryItems: { name: string; isFolder: boolean }[] | undefined;
      if ("dataTransfer" in event && event.dataTransfer) {
        preliminaryItems = Array.from(
          event.dataTransfer.items,
          (item) => {
            const entry =
              (typeof item?.webkitGetAsEntry === "function" &&
                item.webkitGetAsEntry()) ??
              (typeof (item as any)?.getAsEntry === "function" &&
                (item as any).getAsEntry()) ??
              null;
            return {
              name: entry?.name ?? (item.type || "Unknown"),
              isFolder: entry?.isDirectory ?? false,
            };
          },
        ).filter((e) => e.name !== "Unknown");
      } else if (
        "target" in event &&
        event.target instanceof HTMLInputElement &&
        event.target.files
      ) {
        preliminaryItems = Array.from(event.target.files, (f) => ({
          name: f.name,
          isFolder: false,
        }));
      }
      onTraversalStart?.(preliminaryItems);

      fileLimitTruncatedRef.current = false;
      const maxFilesPerUpload = fileSizeLimits.maxFiles ?? 150;
      const planDocumentLimit =
        hasDocumentLimit && isFinite(remainingDocuments)
          ? Math.max(0, remainingDocuments)
          : Infinity;
      const fileLimit = Math.min(maxFilesPerUpload, planDocumentLimit);

      if (fileLimit <= 0) return [];

      // ----- Plain <input type="file"> path: no folder traversal needed.
      if (
        "target" in event &&
        event.target &&
        event.target instanceof HTMLInputElement &&
        event.target.files
      ) {
        const out: FileWithPaths[] = [];
        for (let i = 0; i < event.target.files.length; i++) {
          if (out.length >= fileLimit) break;
          const file: FileWithPaths = event.target.files[i];
          file.path = file.name;
          file.whereToUploadPath = folderPathName;
          file.dataroomUploadPath = folderPathName;
          file.topLevelItemName = file.name;
          file.topLevelItemIsFolder = false;
          out.push(file);
        }
        if (out.length < event.target.files.length) {
          fileLimitTruncatedRef.current = true;
        }
        return out;
      }

      if (!("dataTransfer" in event) || !event.dataTransfer) return [];
      if (!teamInfo?.currentTeam?.id) {
        setRejectedFiles((prev) => [
          { fileName: "Unknown Team", message: "Team Id not found" },
          ...prev,
        ]);
        return [];
      }

      const teamId = teamInfo.currentTeam.id;
      const skippedPerTopLevel = new Map<string, string[]>();

      const readAllDirectoryEntries = async (
        dirReader: FileSystemDirectoryReader,
      ): Promise<FileSystemEntry[]> => {
        const allEntries: FileSystemEntry[] = [];
        let batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          dirReader.readEntries(resolve, reject),
        );
        while (batch.length > 0) {
          allEntries.push(...batch);
          batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
            dirReader.readEntries(resolve, reject),
          );
        }
        return allEntries;
      };

      // Per-file row collected during the walk, before bulk folder creation.
      type PendingFile = {
        entry: FileSystemFileEntry;
        parentTempId: string | null;
        topLevelTempId: string | null;
        topLevelName: string;
        topLevelIsFolder: boolean;
      };

      // Walks one top-level entry, collecting folder rows + file rows. No
      // network I/O happens here — that's deferred to a single bulk POST.
      const walkTopLevel = async (
        topEntry: FileSystemEntry,
      ): Promise<{
        folders: BulkFolderRequestItem[];
        files: PendingFile[];
        topLevelTempId: string | null;
      }> => {
        const folders: BulkFolderRequestItem[] = [];
        const files: PendingFile[] = [];
        let topLevelTempId: string | null = null;

        const recurse = async (
          entry: FileSystemEntry,
          parentTempId: string | null,
        ): Promise<void> => {
          if (isSystemFile(entry.name)) return;

          if (entry.isDirectory) {
            if (entry.name.trim() === "") {
              setRejectedFiles((prev) => [
                { fileName: entry.name, message: "Folder name cannot be empty" },
                ...prev,
              ]);
              return;
            }
            const tempId = crypto.randomUUID();
            folders.push({
              tempId,
              name: entry.name,
              parentTempId,
            });
            if (topLevelTempId === null) topLevelTempId = tempId;

            const subs = await readAllDirectoryEntries(
              (entry as FileSystemDirectoryEntry).createReader(),
            );
            await Promise.all(subs.map((sub) => recurse(sub, tempId)));
          } else if (entry.isFile) {
            files.push({
              entry: entry as FileSystemFileEntry,
              parentTempId,
              topLevelTempId,
              topLevelName: topEntry.name,
              topLevelIsFolder: topEntry.isDirectory,
            });
          }
        };

        await recurse(topEntry, null);
        return { folders, files, topLevelTempId };
      };

      const topEntries = Array.from(event.dataTransfer.items, (item) => {
        const entry =
          (typeof item?.webkitGetAsEntry === "function" &&
            item.webkitGetAsEntry()) ??
          (typeof (item as any)?.getAsEntry === "function" &&
            (item as any).getAsEntry()) ??
          null;
        return entry as FileSystemEntry | null;
      }).filter((e): e is FileSystemEntry => !!e);

      const walkResults = await Promise.all(topEntries.map(walkTopLevel));
      const allFolders = walkResults.flatMap((r) => r.folders);
      const allFiles = walkResults.flatMap((r) => r.files);

      // ----- Bulk-create folders (one request per scope, in parallel).
      const bulkCreateResult = await createFoldersForUpload(allFolders);
      if (!bulkCreateResult) return [];
      const { dataroomByTemp, mainDocsByTemp, dataroomFolderInMainDocsPath } =
        bulkCreateResult;

      // Per-top-level folder count for the upload-drawer progress bar.
      const parentByTemp = new Map(
        allFolders.map((f) => [f.tempId, f.parentTempId ?? null]),
      );
      const folderCountByTopLevelTempId = new Map<string, number>();
      for (const f of allFolders) {
        let cur: string | null = f.parentTempId ?? null;
        let topLevel = f.tempId;
        while (cur) {
          topLevel = cur;
          cur = parentByTemp.get(cur) ?? null;
        }
        folderCountByTopLevelTempId.set(
          topLevel,
          (folderCountByTopLevelTempId.get(topLevel) ?? 0) + 1,
        );
      }

      const filesToBePassedToOnDrop: FileWithPaths[] = [];

      for (let i = 0; i < allFiles.length; i++) {
        if (filesToBePassedToOnDrop.length >= fileLimit) {
          for (let j = i; j < allFiles.length; j++) {
            const skipped = allFiles[j];
            const list =
              skippedPerTopLevel.get(skipped.topLevelName) ?? [];
            list.push(
              skipped.entry.fullPath.startsWith("/")
                ? skipped.entry.fullPath.substring(1)
                : skipped.entry.fullPath,
            );
            skippedPerTopLevel.set(skipped.topLevelName, list);
          }
          fileLimitTruncatedRef.current = true;
          break;
        }

        const pending = allFiles[i];
        let file = await new Promise<FileWithPaths>((resolve) =>
          pending.entry.file(resolve),
        );

        // Firefox can't always detect MIME type from drag-and-dropped folder
        // contents; fall back to the extension table.
        if (file.type === "") {
          const ext = file.name.split(".").pop()?.toLowerCase();
          let correctMimeType: string | undefined;
          if (ext) {
            for (const [mime, extsUntyped] of Object.entries(
              acceptableDropZoneFileTypes,
            )) {
              const exts = extsUntyped as string[];
              if (exts.some((e) => e.toLowerCase() === "." + ext)) {
                correctMimeType = mime;
                break;
              }
            }
          }
          if (correctMimeType) {
            file = new File([file], file.name, {
              type: correctMimeType,
              lastModified: file.lastModified,
            });
          }
        }

        file.path = pending.entry.fullPath.startsWith("/")
          ? pending.entry.fullPath.substring(1)
          : pending.entry.fullPath;

        const mainDocsFolderPath = pending.parentTempId
          ? stripLeadingSlash(mainDocsByTemp.get(pending.parentTempId)?.path)
          : folderPathName;
        const dataroomFolderPath = pending.parentTempId
          ? stripLeadingSlash(dataroomByTemp.get(pending.parentTempId)?.path)
          : folderPathName;

        if (!replicateDataroomFolders && dataroomId && dataroomName) {
          file.whereToUploadPath = dataroomFolderInMainDocsPath;
        } else {
          file.whereToUploadPath = mainDocsFolderPath;
        }
        file.dataroomUploadPath = dataroomId ? dataroomFolderPath : undefined;

        file.topLevelItemName = pending.topLevelName;
        file.topLevelItemIsFolder = pending.topLevelIsFolder;
        if (pending.topLevelTempId) {
          file.topLevelItemFolderCount =
            folderCountByTopLevelTempId.get(pending.topLevelTempId) ?? 0;
          const topLevelDataroom = dataroomByTemp.get(pending.topLevelTempId);
          const topLevelMainDocs = mainDocsByTemp.get(pending.topLevelTempId);
          file.topLevelItemFolderPath = dataroomId
            ? stripLeadingSlash(topLevelDataroom?.path)
            : stripLeadingSlash(topLevelMainDocs?.path);
          file.topLevelDataroomFolderId = topLevelDataroom?.id;
        }

        filesToBePassedToOnDrop.push(file);
      }

      if (skippedPerTopLevel.size > 0) {
        const skippedEntries: RejectedFile[] = [];
        for (const [name, paths] of skippedPerTopLevel) {
          skippedEntries.push({
            fileName: `${name}: ${paths.length} file${paths.length !== 1 ? "s" : ""} not uploaded`,
            message: "Document limit reached",
            reason: "plan-limit",
            skippedFileNames: paths,
          });
        }
        setRejectedFiles((prev) => [...skippedEntries, ...prev]);
      }

      return filesToBePassedToOnDrop;
    },
    [
      folderPathName,
      teamInfo,
      dataroomId,
      dataroomName,
      setRejectedFiles,
      acceptableDropZoneFileTypes,
      hasDocumentLimit,
      remainingDocuments,
      fileSizeLimits,
      replicateDataroomFolders,
      onTraversalStart,
      createFoldersForUpload,
    ],
  );

  // Handle the `<input webkitdirectory>` change event: builds a folder tree
  // from each File's `webkitRelativePath`, bulk-creates the folders, annotates
  // the files with the same metadata produced by the drag-drop walker, then
  // hands them off to `onDrop`. Used by the dedicated folder-upload control
  // in the +Add menu since `<input type="file">` alone cannot preserve
  // hierarchy.
  const handleFolderPickerChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const rawFiles = Array.from(event.target.files ?? []);
      // Reset value so the same folder can be re-picked.
      event.target.value = "";

      if (rawFiles.length === 0) return;

      fileLimitTruncatedRef.current = false;
      const maxFilesPerUpload = fileSizeLimits.maxFiles ?? 150;
      const planDocumentLimit =
        hasDocumentLimit && isFinite(remainingDocuments)
          ? Math.max(0, remainingDocuments)
          : Infinity;
      const fileLimit = Math.min(maxFilesPerUpload, planDocumentLimit);

      if (fileLimit <= 0) {
        onUploadAborted?.();
        return;
      }

      // Surface the top-level folder name(s) immediately so the progress
      // drawer can render before we await the bulk-create round-trip.
      const topLevelNames: string[] = [];
      const seenTopLevel = new Set<string>();
      for (const f of rawFiles) {
        const rel = (f as any).webkitRelativePath || f.name;
        const top = rel.split("/")[0];
        if (top && !seenTopLevel.has(top)) {
          seenTopLevel.add(top);
          topLevelNames.push(top);
        }
      }
      onTraversalStart?.(
        topLevelNames.map((name) => ({ name, isFolder: true })),
      );

      // Filter against the plan's accept map BEFORE we create any folders
      // server-side or sign any S3 uploads. The folder picker bypasses
      // react-dropzone's `accept` validation that the drag-drop and
      // multi-file flows rely on, so without this gate a free-plan user
      // could pick a folder containing paid-only file types (e.g. .docx,
      // .pptx) and walk the whole upload pipeline — bytes would PUT to S3
      // and only be rejected at document-creation time. Also handles the
      // Firefox empty-MIME folder-picker case the same way the drag-drop
      // walker does so consistent files reach `onDrop`.
      const inputFiles: File[] = [];
      const relByFile = new Map<File, string>();
      const rejectedTypePerTopLevel = new Map<
        string,
        { paths: string[]; supportedOnPaid: boolean }
      >();
      for (const raw of rawFiles) {
        const rel = (raw as any).webkitRelativePath || raw.name;
        const segments = rel.split("/").filter((s: string) => s.length > 0);
        const fileName = segments[segments.length - 1] ?? raw.name;
        const top = segments[0] ?? raw.name;
        // Silently skip OS-generated junk (.DS_Store, Thumbs.db, __MACOSX/*).
        // These show up inside the picker's FileList even though the user
        // never sees them; surfacing them as "unsupported" in the rejected
        // list is just noise. Mirrors the drag-drop walker's behavior.
        if (
          isSystemFile(fileName) ||
          segments.some((seg: string) => isSystemFile(seg))
        ) {
          continue;
        }
        const candidate = inferMimeFromExtensionMap(
          raw,
          acceptableDropZoneFileTypes,
        );
        if (!isAcceptableForPlan(candidate, acceptableDropZoneFileTypes)) {
          const supportedOnPaid = isAcceptableForPlan(
            candidate,
            allAcceptableDropZoneMimeTypes,
          );
          const entry = rejectedTypePerTopLevel.get(top) ?? {
            paths: [],
            supportedOnPaid: false,
          };
          entry.paths.push(rel);
          // Treat the group as "paid-only" if ANY rejected file in it would
          // be accepted on a paid plan — surfaces the upgrade-friendly
          // message instead of a generic "unsupported" one.
          entry.supportedOnPaid = entry.supportedOnPaid || supportedOnPaid;
          rejectedTypePerTopLevel.set(top, entry);
          continue;
        }
        inputFiles.push(candidate);
        relByFile.set(candidate, rel);
      }

      if (rejectedTypePerTopLevel.size > 0) {
        const rejectedEntries: RejectedFile[] = [];
        for (const [name, { paths, supportedOnPaid }] of rejectedTypePerTopLevel) {
          // Only a genuine plan limit when the file type would be accepted on a
          // paid plan and the user is actually on a free plan. Otherwise the
          // type is simply unsupported, so upgrading wouldn't help.
          const isPlanLimited = isFree && !isTrial && supportedOnPaid;
          rejectedEntries.push({
            fileName: `${name}: ${paths.length} file${
              paths.length !== 1 ? "s" : ""
            } not uploaded`,
            message: isPlanLimited
              ? "File type not supported on free plan"
              : "File type not supported",
            reason: isPlanLimited ? "plan-limit" : "file-type",
            skippedFileNames: paths,
          });
        }
        setRejectedFiles((prev) => [...rejectedEntries, ...prev]);
      }

      if (inputFiles.length === 0) {
        onUploadAborted?.();
        return;
      }

      // Build folder graph from webkitRelativePath segments. Driven by the
      // validated `inputFiles` so folders that contained only rejected
      // files don't get created server-side.
      const folderTempIdByPath = new Map<string, string>();
      const topLevelTempIdByName = new Map<string, string>();
      const allFolders: BulkFolderRequestItem[] = [];

      for (const file of inputFiles) {
        const rel = relByFile.get(file)!;
        const parts = rel.split("/").filter((s: string) => s.length > 0);
        if (parts.length < 2) continue;
        for (let i = 0; i < parts.length - 1; i++) {
          const segment = parts[i];
          if (isSystemFile(segment) || segment.trim() === "") continue;
          const folderPath = parts.slice(0, i + 1).join("/");
          if (folderTempIdByPath.has(folderPath)) continue;
          const parentPath = i > 0 ? parts.slice(0, i).join("/") : null;
          const parentTempId = parentPath
            ? (folderTempIdByPath.get(parentPath) ?? null)
            : null;
          const tempId = crypto.randomUUID();
          folderTempIdByPath.set(folderPath, tempId);
          if (i === 0) topLevelTempIdByName.set(segment, tempId);
          allFolders.push({ tempId, name: segment, parentTempId });
        }
      }

      const bulkCreateResult = await createFoldersForUpload(allFolders);
      if (!bulkCreateResult) {
        onUploadAborted?.();
        return;
      }
      const { dataroomByTemp, mainDocsByTemp, dataroomFolderInMainDocsPath } =
        bulkCreateResult;

      // Per-top-level folder count for the upload-drawer progress bar.
      const parentByTemp = new Map(
        allFolders.map((f) => [f.tempId, f.parentTempId ?? null]),
      );
      const folderCountByTopLevelTempId = new Map<string, number>();
      for (const f of allFolders) {
        let cur: string | null = f.parentTempId ?? null;
        let topLevel = f.tempId;
        while (cur) {
          topLevel = cur;
          cur = parentByTemp.get(cur) ?? null;
        }
        folderCountByTopLevelTempId.set(
          topLevel,
          (folderCountByTopLevelTempId.get(topLevel) ?? 0) + 1,
        );
      }

      const annotated: FileWithPaths[] = [];
      const skippedPerTopLevel = new Map<string, string[]>();

      for (let i = 0; i < inputFiles.length; i++) {
        const file = inputFiles[i] as FileWithPaths;
        const rel = relByFile.get(file) ?? (file as any).webkitRelativePath ?? file.name;
        const parts: string[] = rel
          .split("/")
          .filter((s: string) => s.length > 0);
        const fileName = parts[parts.length - 1] ?? file.name;
        if (isSystemFile(fileName)) continue;

        if (annotated.length >= fileLimit) {
          const top = parts[0] ?? file.name;
          const list = skippedPerTopLevel.get(top) ?? [];
          list.push(rel);
          skippedPerTopLevel.set(top, list);
          fileLimitTruncatedRef.current = true;
          continue;
        }

        const parentFolderPath =
          parts.length > 1 ? parts.slice(0, -1).join("/") : "";
        const parentTempId = parentFolderPath
          ? (folderTempIdByPath.get(parentFolderPath) ?? null)
          : null;
        const topLevelName = parts[0] ?? file.name;
        const topLevelTempId = topLevelTempIdByName.get(topLevelName) ?? null;
        const isFolderUpload = parts.length > 1;

        file.path = rel;

        const mainDocsFolderPath = parentTempId
          ? stripLeadingSlash(mainDocsByTemp.get(parentTempId)?.path)
          : folderPathName;
        const dataroomFolderPath = parentTempId
          ? stripLeadingSlash(dataroomByTemp.get(parentTempId)?.path)
          : folderPathName;

        if (!replicateDataroomFolders && dataroomId && dataroomName) {
          file.whereToUploadPath = dataroomFolderInMainDocsPath;
        } else {
          file.whereToUploadPath = mainDocsFolderPath;
        }
        file.dataroomUploadPath = dataroomId ? dataroomFolderPath : undefined;

        file.topLevelItemName = topLevelName;
        file.topLevelItemIsFolder = isFolderUpload;
        if (topLevelTempId) {
          file.topLevelItemFolderCount =
            folderCountByTopLevelTempId.get(topLevelTempId) ?? 0;
          const topLevelDataroom = dataroomByTemp.get(topLevelTempId);
          const topLevelMainDocs = mainDocsByTemp.get(topLevelTempId);
          file.topLevelItemFolderPath = dataroomId
            ? stripLeadingSlash(topLevelDataroom?.path)
            : stripLeadingSlash(topLevelMainDocs?.path);
          file.topLevelDataroomFolderId = topLevelDataroom?.id;
        }

        annotated.push(file);
      }

      if (skippedPerTopLevel.size > 0) {
        const skippedEntries: RejectedFile[] = [];
        for (const [name, paths] of skippedPerTopLevel) {
          skippedEntries.push({
            fileName: `${name}: ${paths.length} file${paths.length !== 1 ? "s" : ""} not uploaded`,
            message: "Document limit reached",
            reason: "plan-limit",
            skippedFileNames: paths,
          });
        }
        setRejectedFiles((prev) => [...skippedEntries, ...prev]);
      }

      if (annotated.length === 0) {
        onUploadAborted?.();
        return;
      }

      await onDrop(annotated);
    },
    [
      acceptableDropZoneFileTypes,
      folderPathName,
      dataroomId,
      dataroomName,
      replicateDataroomFolders,
      fileSizeLimits,
      hasDocumentLimit,
      remainingDocuments,
      isFree,
      isTrial,
      onDrop,
      onTraversalStart,
      onUploadAborted,
      setRejectedFiles,
      createFoldersForUpload,
    ],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: acceptableDropZoneFileTypes,
    multiple: true,
    // maxSize: maxSize * 1024 * 1024, // 30 MB
    maxFiles: fileSizeLimits.maxFiles ?? 150,
    onDrop,
    onDropRejected,
    getFilesFromEvent,
    disabled,
    noClick: disabled,
    noDrag: disabled,
    noDragEventsBubbling: disabled,
  });

  // Forward the dropzone's internal input ref into our own ref alongside it,
  // so dropzone's `open()` / cancel-detection paths keep working AND our
  // context-based picker triggers can call `.click()` on the same node.
  // `DropzoneInputProps` doesn't type the `ref` field that `getInputProps()`
  // returns at runtime, so we narrow the shape explicitly here.
  const dropzoneFilesInputProps = getInputProps() as ReturnType<
    typeof getInputProps
  > & {
    ref?: React.Ref<HTMLInputElement>;
  };
  const setFilesInputNode = useCallback(
    (node: HTMLInputElement | null) => {
      filesInputRef.current = node;
      const dropzoneRef = dropzoneFilesInputProps.ref;
      if (typeof dropzoneRef === "function") {
        (dropzoneRef as React.RefCallback<HTMLInputElement>)(node);
      } else if (dropzoneRef) {
        (
          dropzoneRef as React.MutableRefObject<HTMLInputElement | null>
        ).current = node;
      }
    },
    [dropzoneFilesInputProps.ref],
  );

  return (
    <div
      {...getRootProps({ onClick: (evt) => evt.stopPropagation() })}
      className={cn(
        "relative",
        dataroomId ? "min-h-[calc(100vh-350px)]" : "min-h-[calc(100vh-270px)]",
      )}
    >
      <div
        className={cn(
          "absolute inset-0 z-40 -m-1 rounded-lg border-2 border-dashed",
          isDragActive
            ? "pointer-events-auto border-primary/50 bg-gray-100/75 backdrop-blur-sm dark:bg-gray-800/75"
            : "pointer-events-none border-none",
        )}
      >
        <input
          {...dropzoneFilesInputProps}
          ref={setFilesInputNode}
          name="file"
          id="upload-multi-files-zone"
          className="sr-only"
        />

        {/* Dedicated folder picker (preserves directory hierarchy via
            `webkitRelativePath`). Triggered programmatically from the +Add
            menu; the dropzone's regular input above keeps flat-file behavior.
            `webkitdirectory` / `directory` are non-standard so we spread them
            past the typed props. */}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          id="upload-folder-zone"
          className="sr-only"
          onChange={handleFolderPickerChange}
          disabled={disabled}
          aria-hidden="true"
          tabIndex={-1}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />

        {isDragActive && (
          <div className="sticky top-1/2 z-50 -translate-y-1/2 px-2">
            <div className="flex justify-center">
              <div className="inline-flex flex-col rounded-lg bg-background/95 px-6 py-4 text-center ring-1 ring-gray-900/5 dark:bg-gray-900/95 dark:ring-white/10">
                <span className="font-medium text-foreground">
                  Drop your file(s) here
                </span>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {isFree && !isTrial
                    ? `Only *.pdf, *.xls, *.xlsx, *.csv, *.tsv, *.ods, *.png, *.jpeg, *.jpg`
                    : `Only *.pdf, *.pptx, *.docx, *.xlsx, *.xls, *.csv, *.tsv, *.ods, *.ppt, *.odp, *.doc, *.odt, *.md, *.dwg, *.dxf, *.png, *.jpg, *.jpeg, *.mp4, *.mov, *.avi, *.webm, *.ogg, *.log${htmlDocumentsEnabled ? ", *.html, *.htm" : ""}`}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {children}
    </div>
  );
}
