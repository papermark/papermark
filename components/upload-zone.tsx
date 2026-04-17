import { useRouter } from "next/router";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { useTeam } from "@/context/team-context";
import { DocumentStorageType } from "@prisma/client";
import { useSession } from "next-auth/react";
import { DropEvent, FileRejection, useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { mutate } from "swr";

import { useAnalytics } from "@/lib/analytics";
import {
  FREE_PLAN_ACCEPTED_FILE_TYPES,
  FULL_PLAN_ACCEPTED_FILE_TYPES,
  SUPPORTED_DOCUMENT_MIME_TYPES,
} from "@/lib/constants";
import { DocumentData, createDocument } from "@/lib/documents/create-document";
import { resumableUpload } from "@/lib/files/tus-upload";
import {
  createFolderInBoth,
  createFolderInMainDocs,
  determineFolderPaths,
  isSystemFile,
} from "@/lib/folders/create-folder";
import { usePlan } from "@/lib/swr/use-billing";
import useLimits from "@/lib/swr/use-limits";
import { useTeamSettings } from "@/lib/swr/use-team-settings";
import { CustomUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getSupportedContentType } from "@/lib/utils/get-content-type";
import {
  getFileSizeLimit,
  getFileSizeLimits,
} from "@/lib/utils/get-file-size-limits";
import { getPagesCount } from "@/lib/utils/get-page-number-count";

// Originally these mime values were directly used in the dropzone hook.
// There was a solid reason to take them out of the scope, primarily to solve a browser compatibility issue to determine the file type when user dropped a folder.
// you will figure out how this change helped to fix the compatibility issue once you have went through reading of `getFilesFromDropEvent` and `traverseFolder`
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
}

export interface RejectedFile {
  fileName: string;
  message: string;
  reason?: "error" | "plan-limit" | "max-files";
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

interface UploadZoneProps extends React.PropsWithChildren {
  onUploadBatchStart: (batch: UploadBatchState, cancelFn: () => void) => void;
  onUploadBatchUpdate: (batchId: string, update: Partial<UploadBatchState>) => void;
  onUploadRejected: (rejected: RejectedFile[]) => void;
  onUploadSuccess?: (
    files: {
      fileName: string;
      documentId: string;
      dataroomDocumentId: string;
    }[],
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

  const fileSizeLimits = useMemo(
    () =>
      getFileSizeLimits({
        limits,
        isFree,
        isTrial,
      }),
    [limits, isFree, isTrial],
  );

  const acceptableDropZoneFileTypes =
    isFree && !isTrial
      ? acceptableDropZoneMimeTypesWhenIsFreePlanAndNotTrial
      : allAcceptableDropZoneMimeTypes;

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

      const rejected = rejectedFiles.map(({ file, errors }) => {
        let message = "";
        if (errors.find(({ code }) => code === "file-too-large")) {
          const fileSizeLimitMB = getFileSizeLimit(file.type, fileSizeLimits);
          message = `File size too big (max. ${fileSizeLimitMB} MB). Upgrade to a paid plan to increase the limit.`;
        } else if (errors.find(({ code }) => code === "file-invalid-type")) {
          const isSupported = SUPPORTED_DOCUMENT_MIME_TYPES.includes(file.type);
          message = `File type not supported ${
            isFree && !isTrial && isSupported ? `on free plan` : ""
          }`;
        }
        return { fileName: file.name, message };
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

          let contentType = uploadResult.fileType;
          let supportedFileType = getSupportedContentType(contentType) ?? "";

          if (
            uploadResult.fileName.endsWith(".dwg") ||
            uploadResult.fileName.endsWith(".dxf")
          ) {
            supportedFileType = "cad";
            contentType = `image/vnd.${uploadResult.fileName.split(".").pop()}`;
          }

          if (uploadResult.fileName.endsWith(".xlsm")) {
            supportedFileType = "sheet";
            contentType = "application/vnd.ms-excel.sheet.macroEnabled.12";
          }

          if (
            uploadResult.fileName.endsWith(".kml") ||
            uploadResult.fileName.endsWith(".kmz")
          ) {
            supportedFileType = "map";
            contentType = `application/vnd.google-earth.${uploadResult.fileName.endsWith(".kml") ? "kml+xml" : "kmz"}`;
          }

          const documentData: DocumentData = {
            key: uploadResult.id,
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
            numPages: uploadResult.numPages,
            folderPathName: fileUploadPathName,
          });

          mutate(`/api/teams/${teamInfo?.currentTeam?.id}/documents`);

          fileUploadPathName &&
            mutate(
              `/api/teams/${teamInfo?.currentTeam?.id}/folders/documents/${fileUploadPathName}`,
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

              mutate(
                `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/documents`,
              );
              (dataroomUploadPathName || fileUploadPathName) &&
                mutate(
                  `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/folders/documents/${dataroomUploadPathName || fileUploadPathName}`,
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

          return { ...document, dataroomDocumentId: dataroomDocumentId };
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

        mutate(
          `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}?root=true`,
        );
        mutate(`/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}`);
        folderPathName &&
          mutate(
            `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}/${folderPathName}`,
          );

        const uploadedDocuments = results.filter(Boolean);
        const dataroomDocuments = uploadedDocuments.map((document: any) => ({
          documentId: document.id,
          dataroomDocumentId: document.dataroomDocumentId,
          fileName: document.name,
        }));
        onUploadSuccess?.(dataroomDocuments);
      } catch (error) {
        console.error("Upload batch failed:", error);
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
    ],
  );

  const getFilesFromEvent = useCallback(
    async (event: DropEvent) => {
      // This callback also run when event.type =`dragenter`. We only need to compute files when the event.type is `drop`.
      if ("type" in event && event.type !== "drop" && event.type !== "change") {
        return [];
      }

      // Extract top-level item names from the drop so the drawer can show them immediately
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
      let collectedFileCount = 0;
      const skippedPerTopLevel = new Map<string, string[]>();

      // Early check: skip folder traversal (and folder creation) if document limit is already reached
      if (fileLimit <= 0) {
        return [];
      }

      let filesToBePassedToOnDrop: FileWithPaths[] = [];

      /**
       * Reads all entries from a FileSystemDirectoryReader.
       * Per spec, readEntries() returns at most ~100 entries per call in
       * Chromium browsers. It must be called repeatedly until it returns
       * an empty array.
       */
      const readAllDirectoryEntries = async (
        dirReader: FileSystemDirectoryReader,
      ): Promise<FileSystemEntry[]> => {
        const allEntries: FileSystemEntry[] = [];

        let batch: FileSystemEntry[] = await new Promise<FileSystemEntry[]>(
          (resolve, reject) => dirReader.readEntries(resolve, reject),
        );

        while (batch.length > 0) {
          allEntries.push(...batch);
          batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
            dirReader.readEntries(resolve, reject),
          );
        }

        return allEntries;
      };

      /** *********** START OF `traverseFolder` *********** */
      const traverseFolder = async (
        entry: FileSystemEntry,
        parentPathOfThisEntry?: string,
        dataroomParentPath?: string,
        folderCounter?: { count: number },
        folderPathCapture?: { value?: string },
        topLevelName?: string,
      ): Promise<FileWithPaths[]> => {
        /**
         * Summary of this function:
         *  1. if it find a folder then corresponding folder will be created at backend.
         *  2. Smoothly handles the deeply nested folders.
         *  3. Upon folder creation it assign the path and whereToUploadPath to each entry. (Those values will be helpful for `onDrop` to  upload document correctly)
         */

        let files: FileWithPaths[] = [];

        if (isSystemFile(entry.name)) {
          return files;
        }

        if (entry.isDirectory) {
          try {
            if (entry.name.trim() === "") {
              setRejectedFiles((prev) => [
                {
                  fileName: entry.name,
                  message: "Folder name cannot be empty",
                },
                ...prev,
              ]);
              throw new Error("Folder name cannot be empty");
            }

            if (!teamInfo?.currentTeam?.id) {
              /** This case probably may not happen */
              setRejectedFiles((prev) => [
                {
                  fileName: "Unknown Team",
                  message: "Team Id not found",
                },
                ...prev,
              ]);
              throw new Error("No team found");
            }

            // Create folder in main documents if not in dataroom
            if (!dataroomId) {
              // Create folder in main documents only
              const { path: folderPath } = await createFolderInMainDocs({
                teamId: teamInfo.currentTeam.id,
                name: entry.name,
                path: parentPathOfThisEntry ?? folderPathName,
              });

              // Revalidate SWR so the folder appears in the UI immediately
              mutate(`/api/teams/${teamInfo.currentTeam.id}/folders?root=true`);
              const parentPath = parentPathOfThisEntry ?? folderPathName;
              if (parentPath) {
                mutate(
                  `/api/teams/${teamInfo.currentTeam.id}/folders/${parentPath}`,
                );
                mutate(
                  `/api/teams/${teamInfo.currentTeam.id}/folders/documents/${parentPath}`,
                );
              }

              if (folderCounter) folderCounter.count++;
              if (folderPathCapture && folderPathCapture.value === undefined) {
                folderPathCapture.value = folderPath.startsWith("/")
                  ? folderPath.slice(1)
                  : folderPath;
              }
              analytics.capture("Folder Added", { folderName: entry.name });

              const dirReader = (
                entry as FileSystemDirectoryEntry
              ).createReader();
              const subEntries =
                await readAllDirectoryEntries(dirReader);

              const filteredSubEntries = subEntries.filter(
                (subEntry) => !isSystemFile(subEntry.name),
              );

              const resolvedFolderPath = folderPath.startsWith("/")
                ? folderPath.slice(1)
                : folderPath;

              for (const subEntry of filteredSubEntries) {
                files.push(
                  ...(await traverseFolder(
                    subEntry,
                    resolvedFolderPath,
                    undefined,
                    folderCounter,
                    folderPathCapture,
                    topLevelName,
                  )),
                );
              }
            } else {
              const isFirstLevelFolder =
                (parentPathOfThisEntry ?? folderPathName) === folderPathName;

              const {
                parentDataroomPath: targetParentDataroomPath,
                parentMainDocsPath: targetParentMainDocsPath,
              } = determineFolderPaths({
                currentDataroomPath: dataroomParentPath ?? folderPathName,
                currentMainDocsPath: parentPathOfThisEntry,
                isFirstLevelFolder,
              });

              // If replication is disabled, ensure the dataroom folder exists in "All Documents"
              // Uses promise-lock pattern to prevent race conditions
              if (!replicateDataroomFolders && dataroomName) {
                await getOrCreateDataroomFolder();
              }

              const { dataroomPath, mainDocsPath } = await createFolderInBoth({
                teamId: teamInfo.currentTeam.id,
                dataroomId,
                name: entry.name,
                parentMainDocsPath: targetParentMainDocsPath,
                parentDataroomPath: targetParentDataroomPath,
                setRejectedFiles,
                analytics,
                replicateDataroomFolders,
              });

              if (folderCounter) folderCounter.count++;
              if (folderPathCapture && folderPathCapture.value === undefined) {
                folderPathCapture.value = dataroomPath.startsWith("/")
                  ? dataroomPath.slice(1)
                  : dataroomPath;
              }

              const dirReader = (
                entry as FileSystemDirectoryEntry
              ).createReader();
              const subEntries =
                await readAllDirectoryEntries(dirReader);

              const filteredSubEntries = subEntries.filter(
                (subEntry) => !isSystemFile(subEntry.name),
              );

              // Use the resolved paths for all children
              // Guard against undefined mainDocsPath when replication is disabled
              const resolvedMainDocsPath = mainDocsPath
                ? mainDocsPath.startsWith("/")
                  ? mainDocsPath.slice(1)
                  : mainDocsPath
                : undefined;
              const resolvedDataroomPath = dataroomPath.startsWith("/")
                ? dataroomPath.slice(1)
                : dataroomPath;

              for (const subEntry of filteredSubEntries) {
                files.push(
                  ...(await traverseFolder(
                    subEntry,
                    resolvedMainDocsPath,
                    resolvedDataroomPath,
                    folderCounter,
                    folderPathCapture,
                    topLevelName,
                  )),
                );
              }
            }
          } catch (error) {
            console.error(
              "An error occurred while creating the folder: ",
              error,
            );
            setRejectedFiles((prev) => [
              {
                fileName: entry.name,
                message: "Failed to create the folder",
              },
              ...prev,
            ]);
          }
        } else if (entry.isFile) {
          if (isSystemFile(entry.name)) {
            return files;
          }

          if (collectedFileCount >= fileLimit) {
            if (topLevelName) {
              const list = skippedPerTopLevel.get(topLevelName) ?? [];
              list.push(entry.fullPath.startsWith("/") ? entry.fullPath.substring(1) : entry.fullPath);
              skippedPerTopLevel.set(topLevelName, list);
            }
            return files;
          }

          let file = await new Promise<FileWithPaths>((resolve) =>
            (entry as FileSystemFileEntry).file(resolve),
          );

          /** In some browsers e.g firefox is not able to detect the file type. (This only happens when user upload folder) */
          const browserFileTypeCompatibilityIssue = file.type === "";

          if (browserFileTypeCompatibilityIssue) {
            const fileExtension = file.name.split(".").pop()?.toLowerCase();
            let correctMimeType: string | undefined;
            if (fileExtension) {
              // Iterate through acceptableDropZoneFileTypes to find the MIME type for the extension
              for (const [mime, extsUntyped] of Object.entries(
                acceptableDropZoneFileTypes,
              )) {
                const exts = extsUntyped as string[]; // Explicitly type exts
                if (
                  exts.some((ext) => ext.toLowerCase() === "." + fileExtension)
                ) {
                  correctMimeType = mime;
                  break;
                }
              }
            }

            if (correctMimeType) {
              // if we can't do like ```file.type = fileType``` because of [Error: Setting getter-only property "type"]
              // The following is the only best way to resolve the problem
              file = new File([file], file.name, {
                type: correctMimeType,
                lastModified: file.lastModified,
              });
            }
          }

          // Reason of removing "/" because webkitRelativePath doesn't start with "/"
          file.path = entry.fullPath.startsWith("/")
            ? entry.fullPath.substring(1)
            : entry.fullPath;

          // Determine where to upload in "All Documents"
          if (!replicateDataroomFolders && dataroomId && dataroomName) {
            // If replication is disabled, ensure the dataroom folder exists and use it
            // This await is safe because getOrCreateDataroomFolder uses a promise-lock
            const dataroomFolderPath = await getOrCreateDataroomFolder();
            file.whereToUploadPath = dataroomFolderPath;
          } else {
            // If replication is enabled or not in a dataroom, use the normal folder path
            file.whereToUploadPath = parentPathOfThisEntry ?? folderPathName;
          }

          file.dataroomUploadPath = dataroomParentPath;

          files.push(file);
          collectedFileCount++;
        }

        return files;
      };
      /** *********** END OF `traverseFolder` *********** */

      if ("dataTransfer" in event && event.dataTransfer) {
        const items = event.dataTransfer.items;

        const fileResults = await Promise.all(
          Array.from(items, (item) => {
            const entry =
              (typeof item?.webkitGetAsEntry === "function" &&
                item.webkitGetAsEntry()) ??
              (typeof (item as any)?.getAsEntry === "function" &&
                (item as any).getAsEntry()) ??
              null;
            if (!entry) return [];
            const counter = { count: 0 };
            const pathCapture: { value?: string } = {};
            return traverseFolder(
              entry,
              folderPathName,
              dataroomId ? folderPathName : undefined,
              counter,
              pathCapture,
              entry.name,
            ).then((files) => {
              for (const f of files) {
                f.topLevelItemName = entry.name;
                f.topLevelItemIsFolder = entry.isDirectory;
                f.topLevelItemFolderCount = counter.count;
                f.topLevelItemFolderPath = pathCapture.value;
              }
              return files;
            });
          }),
        );
        fileResults.forEach((fileResult) =>
          filesToBePassedToOnDrop.push(...fileResult),
        );
      } else if (
        "target" in event &&
        event.target &&
        event.target instanceof HTMLInputElement &&
        event.target.files
      ) {
        for (let i = 0; i < event.target.files.length; i++) {
          const file: FileWithPaths = event.target.files[i];
          file.path = file.name;
          file.whereToUploadPath = folderPathName;
          file.dataroomUploadPath = folderPathName;
          file.topLevelItemName = file.name;
          file.topLevelItemIsFolder = false;
          filesToBePassedToOnDrop.push(event.target.files[i]);
        }
      }

      if (isFinite(fileLimit) && collectedFileCount >= fileLimit) {
        fileLimitTruncatedRef.current = true;
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
      endpointTargetType,
      teamInfo,
      dataroomId,
      dataroomName,
      analytics,
      setRejectedFiles,
      acceptableDropZoneFileTypes,
      getOrCreateDataroomFolder,
      hasDocumentLimit,
      remainingDocuments,
      fileSizeLimits,
      replicateDataroomFolders,
      onTraversalStart,
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
          {...getInputProps()}
          name="file"
          id="upload-multi-files-zone"
          className="sr-only"
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
                    : `Only *.pdf, *.pptx, *.docx, *.xlsx, *.xls, *.csv, *.tsv, *.ods, *.ppt, *.odp, *.doc, *.odt, *.dwg, *.dxf, *.png, *.jpg, *.jpeg, *.mp4, *.mov, *.avi, *.webm, *.ogg, *.log`}
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
