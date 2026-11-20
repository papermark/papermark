import { DocumentStorageType } from "@prisma/client";

import { ensureFileExtension } from "@/lib/utils/get-content-type";
import { safeSlugify } from "@/lib/utils";

import {
  buildFolderNameMap,
  buildFolderPathsFromHierarchy,
  type FolderInput,
} from "./build-folder-hierarchy";

/**
 * Shape of a single file inside the lambda payload.
 *
 * The bulk-download lambda accepts the full shape; the freeze archive
 * lambda accepts the same shape and ignores the extra fields. Keeping a
 * single shape lets us share the builder.
 */
export type BulkDownloadFile = {
  name: string;
  key: string;
  type?: string;
  numPages?: number;
  needsWatermark?: boolean;
  size?: number;
};

export type BulkDownloadFolderStructure = {
  [path: string]: {
    name: string;
    path: string;
    files: BulkDownloadFile[];
  };
};

/**
 * The minimum document/version shape the builder needs. Callers usually
 * select a few extra fields for their own use; this type is intentionally
 * loose so they don't have to match it exactly.
 */
export interface BulkDownloadDocumentInput {
  id: string;
  folderId: string | null;
  document: {
    id?: string;
    name: string;
    versions: Array<{
      type: string | null;
      file: string;
      originalFile: string | null;
      contentType: string | null;
      storageType: DocumentStorageType;
      numPages?: number | null;
      fileSize?: bigint | number | null;
    }>;
  };
}

export interface BuildBulkDownloadStructureParams {
  /**
   * Full unfiltered folder list for this dataroom. Used for path
   * computation so that parent folders removed by permission filtering
   * still produce the correct child paths (e.g. "/legal/contracts" instead
   * of just "/contracts" when the viewer can't download from "/legal").
   */
  fullFolders: FolderInput[];
  /**
   * Folders the viewer can actually download from. Pass the same list as
   * `fullFolders` if no permission filtering is needed (e.g. team admin).
   */
  includedFolders: FolderInput[];
  /**
   * Documents the viewer can download. Notion documents and VERCEL_BLOB-
   * stored documents are filtered out automatically (the lambda can't
   * handle them).
   */
  includedDocuments: BulkDownloadDocumentInput[];
  /**
   * When true, PDFs are picked from `version.file` (the rendered, ready
   * for watermarking copy). All other types and non-watermarked links use
   * `version.originalFile ?? version.file`.
   */
  enableWatermark?: boolean;
  /**
   * If provided, the resulting structure is rooted at "/<safeSlugify(name)>"
   * instead of "/" - used for folder-scoped downloads where the viewer
   * downloaded a single folder rather than the whole dataroom.
   */
  rootFolder?: { id: string; name: string };
}

export interface BuildBulkDownloadStructureResult {
  folderStructure: BulkDownloadFolderStructure;
  fileKeys: string[];
  /**
   * The subset of `includedDocuments` that actually made it into the
   * structure (i.e. excluding Notion / VERCEL_BLOB / missing-version
   * docs). Useful for view-tracking / metadata where we want to record
   * exactly what was downloaded.
   */
  downloadableDocuments: BulkDownloadDocumentInput[];
}

const isDownloadableVersion = (
  version: BulkDownloadDocumentInput["document"]["versions"][number] | undefined,
): boolean =>
  !!version &&
  version.type !== "notion" &&
  version.storageType !== DocumentStorageType.VERCEL_BLOB;

const pickFileKey = (
  version: BulkDownloadDocumentInput["document"]["versions"][number],
  enableWatermark: boolean,
): string =>
  enableWatermark && version.type === "pdf"
    ? version.file
    : (version.originalFile ?? version.file);

const versionNeedsWatermark = (
  version: BulkDownloadDocumentInput["document"]["versions"][number],
  enableWatermark: boolean,
): boolean | undefined => {
  if (!enableWatermark) return undefined;
  return version.type === "pdf" || version.type === "image" || undefined;
};

/**
 * Strip the leading "/<rootFolderId>'s computed path" prefix from a
 * descendant path. Used when scoping the download under a single folder.
 */
const stripRootPath = (descendantPath: string, rootPath: string): string => {
  if (descendantPath === rootPath) return "";
  if (rootPath && descendantPath.startsWith(rootPath + "/")) {
    return descendantPath.slice(rootPath.length + 1);
  }
  // Descendant isn't actually under the root - shouldn't happen, but
  // fall back to treating it as the descendant's own path.
  return descendantPath.replace(/^\//, "");
};

/**
 * Build the `folderStructure` + `fileKeys` payload that the bulk-download
 * lambda (and the freeze-archive lambda) expects.
 *
 * This is the single source of truth for:
 *  - mapping folder hierarchy to slugified zip paths
 *  - choosing originalFile vs watermark-rendered file
 *  - applying the renamed-document-name + extension fix
 *  - filtering out unsupported storage types (Notion / VERCEL_BLOB)
 *
 * Callers are responsible for permission-filtering folders and documents
 * before passing them in. The full unfiltered folder list is still needed
 * (as `fullFolders`) so child paths render correctly when a parent has
 * canView but not canDownload.
 */
export function buildBulkDownloadStructure({
  fullFolders,
  includedFolders,
  includedDocuments,
  enableWatermark = false,
  rootFolder,
}: BuildBulkDownloadStructureParams): BuildBulkDownloadStructureResult {
  const folderStructure: BulkDownloadFolderStructure = {};
  const fileKeys: string[] = [];
  const downloadableDocuments: BulkDownloadDocumentInput[] = [];

  const computedPathMap = buildFolderPathsFromHierarchy(fullFolders);
  const folderNameMap = buildFolderNameMap(fullFolders, computedPathMap);

  // For folder-scoped downloads, everything is rooted at the root folder's
  // slug. We pre-seed the structure with the root entry so empty folders
  // still produce something the lambda can recognise.
  const scopedRoot = rootFolder
    ? {
        slug: safeSlugify(rootFolder.name),
        computedPath: computedPathMap.get(rootFolder.id) ?? "",
      }
    : null;

  if (scopedRoot) {
    const rootPath = "/" + scopedRoot.slug;
    folderStructure[rootPath] = {
      name: scopedRoot.slug,
      path: rootPath,
      files: [],
    };
  }

  /** Resolve the destination folder path inside the zip for a doc. */
  const resolveZipPath = (folderId: string | null): string | null => {
    if (!folderId) {
      // Root-level doc.
      if (scopedRoot) return "/" + scopedRoot.slug;
      return "/";
    }

    const folderComputedPath = computedPathMap.get(folderId);
    if (!folderComputedPath) return null;

    if (!scopedRoot) return folderComputedPath;

    // Folder-scoped: rebase under the root folder's slug.
    const relative = stripRootPath(folderComputedPath, scopedRoot.computedPath);
    if (!relative) return "/" + scopedRoot.slug;
    return "/" + scopedRoot.slug + "/" + relative;
  };

  /** Ensure every parent folder up to `path` exists in the structure. */
  const ensureFolderChain = (path: string) => {
    if (path === "/") return;

    const parts = path.split("/").filter(Boolean);
    // When folder-scoped, the first segment is the root slug we already
    // pre-seeded — start iterating after it but keep it in `currentPath`
    // so child paths accumulate correctly.
    const startIndex = scopedRoot ? 1 : 0;

    let currentPath = "";
    for (let i = 0; i < startIndex; i++) {
      currentPath += "/" + parts[i];
    }

    for (let i = startIndex; i < parts.length; i++) {
      const part = parts[i];
      currentPath += "/" + part;
      if (folderStructure[currentPath]) continue;

      // For the inner folders, look up the folderNameMap to get a nicer
      // display name (it may differ from the slug for non-ASCII names).
      let displayName = part;
      if (!scopedRoot) {
        const info = folderNameMap.get(currentPath);
        if (info) displayName = info.name;
      }

      folderStructure[currentPath] = {
        name: displayName,
        path: currentPath,
        files: [],
      };
    }
  };

  const includedFolderIds = new Set(includedFolders.map((f) => f.id));

  /** Add a single document to the structure. */
  const addDocument = (doc: BulkDownloadDocumentInput) => {
    const version = doc.document.versions[0];
    if (!isDownloadableVersion(version)) return;

    // Documents inside folders are only included if the folder itself is
    // permission-allowed. Root-level docs (folderId == null) are always
    // included if the caller passed them.
    if (doc.folderId && !includedFolderIds.has(doc.folderId)) return;

    const zipPath = resolveZipPath(doc.folderId);
    if (zipPath == null) return;

    ensureFolderChain(zipPath);

    if (!folderStructure[zipPath]) {
      // Root-level write into "/" when not scoped.
      folderStructure[zipPath] = {
        name: zipPath === "/" ? "Root" : zipPath.split("/").pop() || "Root",
        path: zipPath,
        files: [],
      };
    }

    const safeName = ensureFileExtension({
      name: doc.document.name,
      contentType: version.contentType,
      type: version.type,
    });
    // Watermarked PDFs always end in .pdf because the lambda renders
    // them through mupdf and saves them as PDFs regardless of upload type.
    const finalName =
      enableWatermark && version.type === "pdf"
        ? ensureFileExtension({
            name: doc.document.name,
            contentType: "application/pdf",
          })
        : safeName;

    const fileKey = pickFileKey(version, enableWatermark);

    folderStructure[zipPath].files.push({
      name: finalName,
      key: fileKey,
      type: version.type ?? undefined,
      numPages: version.numPages ?? undefined,
      needsWatermark: versionNeedsWatermark(version, enableWatermark),
      size:
        version.fileSize != null
          ? typeof version.fileSize === "bigint"
            ? Number(version.fileSize)
            : version.fileSize
          : undefined,
    });
    fileKeys.push(fileKey);
    downloadableDocuments.push(doc);
  };

  for (const doc of includedDocuments) {
    addDocument(doc);
  }

  // Make sure every permitted folder has at least an entry in the
  // structure (even if empty) so the lambda recreates it in the zip.
  for (const folder of includedFolders) {
    const zipPath = resolveZipPath(folder.id);
    if (zipPath == null) continue;
    ensureFolderChain(zipPath);
  }

  return { folderStructure, fileKeys, downloadableDocuments };
}
