import { useRouter } from "next/router";

import { useEffect, useMemo, useState } from "react";
import React from "react";

import { usePendingUploads } from "@/context/pending-uploads-context";
import { ViewerChatPanel } from "@/ee/features/ai/components/viewer-chat-panel";
import {
  ViewerChatLayout,
  ViewerChatProvider,
} from "@/ee/features/ai/components/viewer-chat-provider";
import { ViewerChatToggle } from "@/ee/features/ai/components/viewer-chat-toggle";
import {
  type DataroomCardLayout,
  type DataroomViewerHeaderStyle,
  asDataroomCardLayout,
  asDataroomViewerHeaderStyle,
} from "@/ee/features/branding/lib/dataroom-viewer-layout";
import {
  ConversationSidebarLayout,
  ConversationSidebarProvider,
} from "@/ee/features/conversations/components/viewer/conversation-sidebar-provider";
import { RequestListButton } from "@/ee/features/request-lists/components/viewer/request-list-button";
import { useViewerRequestList } from "@/ee/features/request-lists/lib/swr/use-viewer-request-list";
import {
  DataroomBrand,
  DataroomFolder,
  PermissionGroupAccessControls,
  ViewerGroupAccessControls,
} from "@prisma/client";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { PanelLeftIcon, UploadIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  HIERARCHICAL_DISPLAY_STYLE,
  getHierarchicalDisplayName,
} from "@/lib/utils/hierarchical-display";
import { sortByIndexThenName } from "@/lib/utils/sort-items-by-index-name";

import { ViewFolderTree } from "@/components/datarooms/folders";
import { SearchBoxPersisted } from "@/components/search-box";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Sheet,
  SheetOverlay,
  SheetPortal,
  SheetTrigger,
} from "@/components/ui/sheet";

import { CompactDataroomListHeader } from "../dataroom/compact-dataroom-list-header";
import { DataroomNoBannerTitle } from "../dataroom/dataroom-no-banner-title";
import {
  DataroomTrailingActions,
  VIEWER_OPEN_DOWNLOAD_EVENT,
  VIEWER_TOGGLE_CONVERSATIONS_EVENT,
} from "../dataroom/dataroom-trailing-actions";
import { DEFAULT_DATAROOM_VIEW_TYPE } from "../dataroom/dataroom-view";
import DocumentCard from "../dataroom/document-card";
import { DocumentUploadModal } from "../dataroom/document-upload-modal";
import FolderCard from "../dataroom/folder-card";
import IndexFileDialog from "../dataroom/index-file-dialog";
import {
  IntroductionInfoButton,
  IntroductionProvider,
} from "../dataroom/introduction-modal";
import DataroomNav from "../dataroom/nav-dataroom";
import PendingDocumentCard from "../dataroom/pending-document-card";
import {
  ViewerSurfaceThemeProvider,
  createViewerSurfaceTheme,
} from "./viewer-surface-theme";

const ViewerBreadcrumbItem = ({
  folder,
  setFolderId,
  isLast,
  dataroomIndexEnabled,
}: {
  folder: any;
  setFolderId: (id: string | null) => void;
  isLast: boolean;
  dataroomIndexEnabled?: boolean;
}) => {
  const displayName = getHierarchicalDisplayName(
    folder.name,
    folder.hierarchicalIndex,
    dataroomIndexEnabled || false,
  );

  if (isLast) {
    return (
      <BreadcrumbPage
        className="font-medium capitalize text-[var(--viewer-text)]"
        style={HIERARCHICAL_DISPLAY_STYLE}
      >
        {displayName}
      </BreadcrumbPage>
    );
  }

  return (
    <BreadcrumbLink
      onClick={() => setFolderId(folder.id)}
      className="-mx-1.5 cursor-pointer rounded-md px-1.5 py-0.5 capitalize text-[var(--viewer-muted-text)] transition-colors hover:bg-[var(--viewer-panel-bg-hover)] hover:text-[var(--viewer-text)]"
      style={HIERARCHICAL_DISPLAY_STYLE}
    >
      {displayName}
    </BreadcrumbLink>
  );
};

type FolderOrDocument =
  | (DataroomFolder & { allowDownload: boolean })
  | DataroomDocument;

export type DocumentVersion = {
  id: string;
  type: string;
  versionNumber: number;
  hasPages: boolean;
  isVertical: boolean;
  updatedAt: Date;
  fileSize?: number | bigint | null;
};

type DataroomDocument = {
  dataroomDocumentId: string;
  folderId: string | null;
  id: string;
  name: string;
  orderIndex: number | null;
  downloadOnly: boolean;
  versions: DocumentVersion[];
  canDownload: boolean;
  canView: boolean;
  hierarchicalIndex: string | null;
};

type GridRun = { kind: "folder" | "document"; items: FolderOrDocument[] };

/** Preserve sort order but split into runs so folder vs document grids can differ. */
function segmentMixedItemsForGrid(items: FolderOrDocument[]): GridRun[] {
  const segments: GridRun[] = [];
  for (const item of items) {
    const kind: "folder" | "document" =
      "versions" in item ? "document" : "folder";
    const last = segments[segments.length - 1];
    if (last?.kind === kind) {
      last.items.push(item);
    } else {
      segments.push({ kind, items: [item] });
    }
  }
  return segments;
}

const getParentFolders = (
  folderId: string | null,
  folders: DataroomFolder[],
): DataroomFolder[] => {
  const breadcrumbFolders: DataroomFolder[] = [];
  let currentFolder = folders.find((folder) => folder.id === folderId);

  while (currentFolder) {
    breadcrumbFolders.unshift(currentFolder);
    currentFolder = folders.find(
      (folder) => folder.id === currentFolder!.parentId,
    );
  }

  return breadcrumbFolders;
};

export default function DataroomViewer({
  brand,
  viewId,
  linkId,
  dataroom,
  allowDownload,
  isPreview,
  folderId,
  setFolderId,
  accessControls,
  viewerId,
  viewData,
  enableIndexFile,
  isEmbedded,
  viewerEmail,
  dataroomIndexEnabled,
  showPoweredByBanner,
}: {
  brand: Partial<DataroomBrand>;
  viewId?: string;
  linkId: string;
  dataroom: any;
  allowDownload: boolean;
  isPreview?: boolean;
  folderId: string | null;
  setFolderId: React.Dispatch<React.SetStateAction<string | null>>;
  accessControls: ViewerGroupAccessControls[] | PermissionGroupAccessControls[];
  viewerId?: string;
  viewData: DEFAULT_DATAROOM_VIEW_TYPE;
  enableIndexFile?: boolean;
  isEmbedded?: boolean;
  viewerEmail?: string;
  dataroomIndexEnabled?: boolean;
  showPoweredByBanner?: boolean;
}) {
  const { documents, folders, allowBulkDownload } = dataroom as {
    documents: DataroomDocument[];
    folders: DataroomFolder[];
    allowBulkDownload: boolean;
  };

  const router = useRouter();
  const { t } = useTranslation("dataroom");
  const searchQuery = (router.query.search as string)?.toLowerCase() || "";

  // Tab state: "documents" (normal view) or "my-uploads" (visitor's uploads)
  const [activeTab, setActiveTab] = useState<"documents" | "my-uploads">(
    "documents",
  );

  // Get pending uploads (in-flight + persisted from server)
  const {
    getPendingUploadsForFolder,
    getAllUploads,
    hasUploads,
    updatePendingUpload,
  } = usePendingUploads();
  const pendingUploadsForFolder = getPendingUploadsForFolder(folderId);
  const allUploads = getAllUploads();

  const breadcrumbFolders = useMemo(
    () => getParentFolders(folderId, folders),
    [folderId, folders],
  );

  const toolbarBreadcrumbEl = useMemo(
    () => (
      <Breadcrumb>
        <BreadcrumbList className="text-[var(--viewer-muted-text)]">
          <BreadcrumbItem key="root">
            <BreadcrumbLink
              onClick={() => setFolderId(null)}
              className="-mx-1.5 cursor-pointer rounded-md px-1.5 py-0.5 text-[var(--viewer-muted-text)] transition-colors hover:bg-[var(--viewer-panel-bg-hover)] hover:text-[var(--viewer-text)]"
            >
              {t("breadcrumb.home", "Home")}
            </BreadcrumbLink>
          </BreadcrumbItem>

          {breadcrumbFolders.map((folder, index) => (
            <React.Fragment key={folder.id}>
              <BreadcrumbSeparator className="text-[var(--viewer-subtle-text)]" />
              <BreadcrumbItem>
                <ViewerBreadcrumbItem
                  folder={folder}
                  setFolderId={setFolderId}
                  isLast={index === breadcrumbFolders.length - 1}
                  dataroomIndexEnabled={dataroomIndexEnabled}
                />
              </BreadcrumbItem>
            </React.Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    ),
    [breadcrumbFolders, dataroomIndexEnabled, setFolderId, t],
  );

  // Index access controls by `itemId` once per change so the per-document
  // lookups below are O(1) instead of O(A). Without this, the descendant
  // walk and the per-render `mixedItems` build each do an N×M scan over
  // documents × accessControls, which becomes noticeable past a few
  // thousand items in the dataroom.
  const accessControlByItemId = useMemo(() => {
    const map = new Map<
      string,
      ViewerGroupAccessControls | PermissionGroupAccessControls
    >();
    for (const access of accessControls) {
      map.set(access.itemId, access);
    }
    return map;
  }, [accessControls]);

  const allDocumentsCanDownload = useMemo(() => {
    if (!allowDownload) return false;
    if (!documents || documents.length === 0) return false;

    return documents.some((doc) => {
      if (doc.versions[0].type === "notion") return false;
      const accessControl = accessControlByItemId.get(doc.dataroomDocumentId);
      return accessControl?.canDownload ?? true;
    });
  }, [documents, accessControlByItemId, allowDownload]);

  // For each folder, whether *any* descendant document is downloadable for
  // this viewer. The folder card's download menu is shown whenever this is
  // true, so a folder that's only "partially downloadable" (e.g. one nested
  // doc downloadable, others not) still surfaces the action — matching what
  // the bulk-download job actually produces (it permission-filters in
  // `lib/trigger/bulk-download.ts`).
  const folderHasDownloadableDescendant = useMemo(() => {
    const result = new Map<string, boolean>();

    // Resolve a single doc's downloadability against the viewer's access
    // controls. `canDownload` defaults to true when no explicit row exists,
    // matching the per-document logic elsewhere in this file.
    const isDocDownloadable = (doc: DataroomDocument): boolean => {
      if (doc.versions[0]?.type === "notion") return false;
      const accessControl = accessControlByItemId.get(doc.dataroomDocumentId);
      return accessControl?.canDownload ?? true;
    };

    const folderChildren = new Map<string, string[]>();
    const folderDocsMap = new Map<string, DataroomDocument[]>();

    folders.forEach((folder) => {
      const parentId = folder.parentId || "root";
      if (!folderChildren.has(parentId)) folderChildren.set(parentId, []);
      folderChildren.get(parentId)!.push(folder.id);
    });

    documents.forEach((doc) => {
      const fid = doc.folderId || "root";
      if (!folderDocsMap.has(fid)) folderDocsMap.set(fid, []);
      folderDocsMap.get(fid)!.push(doc);
    });

    const compute = (folderId: string): boolean => {
      const cached = result.get(folderId);
      if (cached !== undefined) return cached;

      const docs = folderDocsMap.get(folderId) || [];
      if (docs.some(isDocDownloadable)) {
        result.set(folderId, true);
        return true;
      }

      const children = folderChildren.get(folderId) || [];
      const hasDownloadableChild = children.some(compute);

      result.set(folderId, hasDownloadableChild);
      return hasDownloadableChild;
    };

    folders.forEach((folder) => compute(folder.id));

    return result;
  }, [folders, documents, accessControlByItemId]);

  // Efficiently calculate effective updatedAt for all folders in a single pass
  const folderEffectiveUpdatedAt = useMemo(() => {
    const effectiveUpdatedAt = new Map<string, Date>();

    // Create maps for fast lookups
    const folderChildren = new Map<string, string[]>();
    const folderDocuments = new Map<string, DataroomDocument[]>();

    // Build folder hierarchy map
    folders.forEach((folder) => {
      const parentId = folder.parentId || "root";
      if (!folderChildren.has(parentId)) {
        folderChildren.set(parentId, []);
      }
      folderChildren.get(parentId)!.push(folder.id);
    });

    // Build document map
    documents.forEach((doc) => {
      const folderId = doc.folderId || "root";
      if (!folderDocuments.has(folderId)) {
        folderDocuments.set(folderId, []);
      }
      folderDocuments.get(folderId)!.push(doc);
    });

    // Calculate effective updatedAt bottom-up (post-order traversal)
    const calculateEffectiveUpdatedAt = (folderId: string): Date => {
      // Return cached result if already calculated
      if (effectiveUpdatedAt.has(folderId)) {
        return effectiveUpdatedAt.get(folderId)!;
      }

      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return new Date(0);

      let maxDate = new Date(folder.updatedAt);

      // Check documents in this folder
      const docsInFolder = folderDocuments.get(folderId) || [];
      docsInFolder.forEach((doc) => {
        if (doc.versions && doc.versions.length > 0) {
          const docDate = new Date(doc.versions[0].updatedAt);
          if (docDate > maxDate) maxDate = docDate;
        }
      });

      // Check child folders recursively
      const childFolderIds = folderChildren.get(folderId) || [];
      childFolderIds.forEach((childId) => {
        const childDate = calculateEffectiveUpdatedAt(childId);
        if (childDate > maxDate) maxDate = childDate;
      });

      // Cache and return result
      effectiveUpdatedAt.set(folderId, maxDate);
      return maxDate;
    };

    // Calculate for all folders
    folders.forEach((folder) => {
      calculateEffectiveUpdatedAt(folder.id);
    });

    return effectiveUpdatedAt;
  }, [folders, documents]);

  const cardLayout: DataroomCardLayout = asDataroomCardLayout(
    (brand as any)?.cardLayout,
  );

  const viewerHeaderStyle: DataroomViewerHeaderStyle =
    asDataroomViewerHeaderStyle(
      (brand as { viewerHeaderStyle?: string }).viewerHeaderStyle,
    );

  const isModernLayout = viewerHeaderStyle === "SPLIT";

  // Notion preset hides the dataroom navbar entirely (just a cover image +
  // title). The nav's trailing buttons (CTA, conversations, download) get
  // hoisted into the body toolbar so they sit on the right of the search.
  const notionHasBanner =
    (brand?.banner ?? null) !== "no-banner" && !!brand?.banner;
  const isNotionLayout = viewerHeaderStyle === "NOTION" && notionHasBanner;

  // create a mixedItems array with folders and documents of the current folder and memoize it
  const mixedItems = useMemo(() => {
    // If there's a search query, filter documents by name across all folders
    if (searchQuery) {
      return (documents || [])
        .filter((doc) => doc.name.toLowerCase().includes(searchQuery))
        .map((doc) => {
          const accessControl = accessControlByItemId.get(
            doc.dataroomDocumentId,
          );

          return {
            ...doc,
            itemType: "document",
            canDownload:
              (accessControl?.canDownload ?? true) &&
              doc.versions[0].type !== "notion",
          };
        })
        .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
    }

    const folderItems: FolderOrDocument[] = (folders || [])
      .filter((folder) => folder.parentId === folderId)
      .map((folder) => {
        // Get pre-calculated effective updatedAt
        const effectiveUpdatedAt =
          folderEffectiveUpdatedAt.get(folder.id) || new Date(folder.updatedAt);

        // Show the download action when any descendant doc is downloadable
        // — including the partial case where some are and some aren't, and
        // the deeply-nested case where the only downloadable doc lives
        // several levels below this folder.
        const hasDownloadableDescendant =
          folderHasDownloadableDescendant.get(folder.id) ?? false;

        return {
          ...folder,
          updatedAt: effectiveUpdatedAt,
          itemType: "folder",
          allowDownload: allowDownload && hasDownloadableDescendant,
        };
      });

    const documentItems: FolderOrDocument[] = (documents || [])
      .filter((doc) => doc.folderId === folderId)
      .map((doc) => {
        const accessControl = accessControlByItemId.get(doc.dataroomDocumentId);

        return {
          ...doc,
          itemType: "document",
          canDownload:
            (accessControl?.canDownload ?? true) &&
            doc.versions[0].type !== "notion",
        };
      });

    // Notion design always groups folders above documents in a clean two-row
    // grid; other layouts keep the legacy interleaved order so admins can mix
    // folders/docs by orderIndex.
    if (isNotionLayout) {
      return [
        ...sortByIndexThenName(folderItems),
        ...sortByIndexThenName(documentItems),
      ];
    }

    return sortByIndexThenName([...folderItems, ...documentItems]);
  }, [
    folders,
    documents,
    folderId,
    accessControlByItemId,
    allowDownload,
    folderEffectiveUpdatedAt,
    folderHasDownloadableDescendant,
    searchQuery,
    isNotionLayout,
  ]);

  const compactListShowsActionsColumn = useMemo(() => {
    if (cardLayout !== "COMPACT" || !allowDownload) return false;
    return mixedItems.some((item) =>
      "versions" in item ? item.canDownload : item.allowDownload,
    );
  }, [cardLayout, allowDownload, mixedItems]);

  const compactTableShowUpdated =
    cardLayout === "COMPACT" && (dataroom?.showLastUpdated ?? true);

  const filteredPendingUploads = useMemo(
    () =>
      pendingUploadsForFolder.filter((u) => {
        if (!u.documentId) return true;
        return !mixedItems.some(
          (item) => "versions" in item && item.id === u.documentId,
        );
      }),
    [pendingUploadsForFolder, mixedItems],
  );

  // Fallback reconciliation: if the document is already visible and ready,
  // mark its pending upload as complete even if realtime status was missed.
  useEffect(() => {
    allUploads.forEach((upload) => {
      if (upload.status !== "processing" || !upload.documentId) return;

      const matchingDocument = documents.find(
        (doc) => doc.id === upload.documentId,
      );
      if (!matchingDocument) return;

      const primaryVersion = matchingDocument.versions[0];
      if (!primaryVersion) return;

      const needsProcessing = ["pdf", "docs", "slides"].includes(
        primaryVersion.type,
      );
      const isReady = !needsProcessing || primaryVersion.hasPages;

      if (isReady) {
        updatePendingUpload(upload.id, { status: "complete" });
      }
    });
  }, [allUploads, documents, updatePendingUpload]);

  const renderItem = (item: FolderOrDocument, editorialIndex = 0) => {
    if ("versions" in item) {
      const isProcessing =
        ["docs", "slides", "pdf"].includes(item.versions[0].type) &&
        !item.versions[0].hasPages;

      return (
        <DocumentCard
          key={item.id}
          document={item}
          linkId={linkId}
          viewId={viewId}
          isPreview={!!isPreview}
          allowDownload={allowDownload && item.canDownload}
          isProcessing={isProcessing}
          dataroomIndexEnabled={dataroomIndexEnabled}
          showLastUpdated={dataroom?.showLastUpdated ?? true}
          layout={cardLayout}
          compactShowUpdatedColumn={compactTableShowUpdated}
          compactShowActionsColumn={compactListShowsActionsColumn}
          compactShowIndexColumn={cardLayout === "COMPACT"}
          editorialIndex={editorialIndex}
        />
      );
    }

    return (
      <FolderCard
        key={item.id}
        folder={item}
        dataroomId={dataroom?.id}
        setFolderId={setFolderId}
        isPreview={!!isPreview}
        linkId={linkId}
        viewId={viewId}
        allowDownload={item.allowDownload}
        dataroomIndexEnabled={dataroomIndexEnabled}
        showLastUpdated={dataroom?.showLastUpdated ?? true}
        layout={cardLayout}
        hideFolderIcons={hideFolderIconsInMain}
        compactShowUpdatedColumn={compactTableShowUpdated}
        compactShowActionsColumn={compactListShowsActionsColumn}
        compactShowIndexColumn={cardLayout === "COMPACT"}
        editorialIndex={editorialIndex}
      />
    );
  };

  const viewerSurfaceTheme = useMemo(
    () =>
      createViewerSurfaceTheme(
        (brand as any)?.applyAccentColorToDataroomView
          ? brand?.accentColor
          : "#ffffff",
      ),
    [brand],
  );

  const showFolderTree = (brand as any)?.showFolderTree !== false;
  const showLeftColumnDesktop = showFolderTree;
  const showNoBannerTitle = brand?.banner === "no-banner";
  const hideFolderIconsInMain =
    (brand as { hideFolderIconsInMain?: boolean }).hideFolderIconsInMain ===
    true;

  const itemListClassName = cn(
    "overflow-auto",
    cardLayout === "GRID"
      ? "" // GRID uses segmented lists below
      : cardLayout === "COMPACT"
        ? ""
        : "-mx-4 space-y-4 p-4",
  );

  const folderGridListClassName = cn(
    "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4",
  );
  const documentGridListClassName = cn(
    "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
  );

  // Shared className for body-toolbar trigger buttons (Generate Index, Add
  // Document) so they blend with the dataroom's current surface — light on
  // white backgrounds, dark on accent-colored backgrounds, etc. Mirrors the
  // search input's adaptive styling.
  const viewerThemedTriggerClass =
    "border-[var(--viewer-control-border)] bg-[var(--viewer-control-bg)] text-[var(--viewer-text)] hover:bg-[var(--viewer-panel-bg-hover)] hover:text-[var(--viewer-text)]";

  // Whether to show the Request List trigger button in the toolbar (next to
  // Add document / Search / Introduction). Shares its detection request with
  // the nav's sheet via SWR dedup.
  const { enabled: requestListEnabled } = useViewerRequestList({
    linkId,
    dataroomId: dataroom?.id,
    viewerId,
    isPreview,
  });
  const mobileTreeTheme = useMemo(
    () => ({
      ...viewerSurfaceTheme,
      textTone: "dark" as const,
      usesLightText: false,
    }),
    [viewerSurfaceTheme],
  );

  // Prepare documents for chat context
  const documentsForChat = documents.map((doc) => ({
    dataroomDocumentId: doc.dataroomDocumentId,
    id: doc.id,
    name: doc.name,
    folderId: doc.folderId,
  }));

  return (
    <IntroductionProvider dataroom={dataroom} viewerId={viewerId}>
      <ConversationSidebarProvider>
        <ViewerChatProvider
          enabled={viewData.agentsEnabled}
          dataroomId={dataroom?.id}
          dataroomName={viewData.dataroomName}
          linkId={linkId}
          viewId={viewId}
          viewerId={viewerId}
          documents={documentsForChat}
          folders={folders}
        >
          <DataroomNav
            brand={brand}
            linkId={linkId}
            viewId={viewId}
            dataroom={dataroom}
            allowDownload={allDocumentsCanDownload}
            allowBulkDownload={allowBulkDownload}
            isPreview={isPreview}
            dataroomId={dataroom?.id}
            viewerId={viewerId}
            viewerEmail={viewerEmail}
            conversationsEnabled={viewData.conversationsEnabled}
            isTeamMember={viewData.isTeamMember}
            topBarBreadcrumb={isModernLayout ? toolbarBreadcrumbEl : undefined}
            topBarSearch={
              isModernLayout ? (
                <SearchBoxPersisted
                  placeholder={t("search.placeholder", "Search...")}
                  inputClassName="h-9 border-[var(--viewer-control-border)] bg-[var(--viewer-control-bg)] text-[var(--viewer-text)] placeholder:text-[var(--viewer-placeholder)] shadow-sm hover:border-[var(--viewer-control-border-strong)] focus:border-[var(--viewer-control-border-strong)]"
                  leftIconClassName="text-[var(--viewer-control-icon)]"
                  clearIconClassName="text-[var(--viewer-control-icon)] hover:text-[var(--viewer-text)]"
                />
              ) : undefined
            }
            topBarTrailingActions={
              isModernLayout ? (
                <>
                  <IntroductionInfoButton />
                  {enableIndexFile &&
                    (isPreview || (viewId && viewerId)) && (
                      <IndexFileDialog
                        linkId={linkId}
                        viewId={viewId ?? ""}
                        dataroomId={dataroom?.id}
                        viewerId={viewerId}
                        viewerEmail={viewerEmail}
                        isPreview={isPreview}
                        triggerClassName={viewerThemedTriggerClass}
                      />
                    )}
                  {viewData?.enableVisitorUpload &&
                    (isPreview || viewerId) && (
                      <DocumentUploadModal
                        linkId={linkId}
                        dataroomId={dataroom?.id}
                        viewerId={viewerId ?? ""}
                        isPreview={isPreview}
                        folderId={folderId ?? undefined}
                        folderName={
                          folderId
                            ? folders.find((f) => f.id === folderId)?.name
                            : undefined
                        }
                        allowedFolders={viewData?.uploadFolderAllowList}
                        triggerClassName={viewerThemedTriggerClass}
                      />
                    )}
                  {requestListEnabled && (
                    <RequestListButton className={viewerThemedTriggerClass} />
                  )}
                </>
              ) : undefined
            }
            surfaceBackgroundColor={
              (brand as any)?.applyAccentColorToDataroomView
                ? (brand?.accentColor ?? null)
                : null
            }
          />
          <ViewerSurfaceThemeProvider value={viewerSurfaceTheme}>
            <ViewerChatLayout>
              <ConversationSidebarLayout>
                <div
                  className="relative flex flex-1 flex-col bg-white dark:bg-black"
                  style={
                    viewerSurfaceTheme.palette.backgroundColor
                      ? {
                          backgroundColor:
                            viewerSurfaceTheme.palette.backgroundColor,
                        }
                      : undefined
                  }
                >
                  <div
                    className="relative mx-auto flex w-full flex-1 flex-col"
                    style={
                      {
                        "--viewer-text": viewerSurfaceTheme.palette.textColor,
                        "--viewer-muted-text":
                          viewerSurfaceTheme.palette.mutedTextColor,
                        "--viewer-subtle-text":
                          viewerSurfaceTheme.palette.subtleTextColor,
                        "--viewer-panel-bg":
                          viewerSurfaceTheme.palette.panelBgColor,
                        "--viewer-panel-bg-hover":
                          viewerSurfaceTheme.palette.panelHoverBgColor,
                        "--viewer-panel-border":
                          viewerSurfaceTheme.palette.panelBorderColor,
                        "--viewer-panel-border-hover":
                          viewerSurfaceTheme.palette.panelBorderHoverColor,
                        "--viewer-control-bg":
                          viewerSurfaceTheme.palette.controlBgColor,
                        "--viewer-control-border":
                          viewerSurfaceTheme.palette.controlBorderColor,
                        "--viewer-control-border-strong":
                          viewerSurfaceTheme.palette.controlBorderStrongColor,
                        "--viewer-control-icon":
                          viewerSurfaceTheme.palette.controlIconColor,
                        "--viewer-placeholder":
                          viewerSurfaceTheme.palette.controlPlaceholderColor,
                        // Brand accent — opt-in highlights for index prefix, breadcrumb
                        // leaf, etc. Falls back to brand color, then the surface text
                        // color so it always reads on the current surface.
                        "--viewer-accent":
                          (brand as any)?.accentButtonColor ||
                          brand?.brandColor ||
                          viewerSurfaceTheme.palette.textColor,
                      } as React.CSSProperties
                    }
                  >
                    <div className="flex w-full flex-1 items-start justify-center">
                      {showLeftColumnDesktop && (
                        <div
                          className="sticky top-0 hidden max-h-screen shrink-0 self-start overflow-y-auto overflow-x-hidden px-3 pb-4 pt-4 md:block md:px-4 md:pt-6 lg:px-6 lg:pt-9 xl:px-8"
                          style={{
                            width: "clamp(260px, 28vw, 440px)",
                          }}
                        >
                          {showNoBannerTitle ? (
                            <DataroomNoBannerTitle
                              name={dataroom.name}
                              lastUpdatedAt={dataroom.lastUpdatedAt}
                              showLastUpdated={dataroom.showLastUpdated}
                              className="mb-3"
                            />
                          ) : null}
                          {showFolderTree && (
                            <ViewFolderTree
                              folders={folders}
                              documents={documents}
                              setFolderId={setFolderId}
                              folderId={folderId}
                              dataroomIndexEnabled={dataroomIndexEnabled}
                            />
                          )}
                        </div>
                      )}

                      {/* Detail view — scrolls with the page, not in its own viewport */}
                      <div className="min-w-0 flex-grow">
                        <div className="px-3 pb-4 pt-4 md:px-6 md:pt-6 lg:px-8 lg:pt-9 xl:px-14">
                          {showNoBannerTitle && !showLeftColumnDesktop ? (
                            <DataroomNoBannerTitle
                              name={dataroom.name}
                              lastUpdatedAt={dataroom.lastUpdatedAt}
                              showLastUpdated={dataroom.showLastUpdated}
                              className="mb-2 md:mb-3"
                            />
                          ) : null}
                          {/* Modern (SPLIT + LIST) renders its toolbar (breadcrumb,
                      search, action buttons) inside the nav top-row so the
                      body skips this section entirely. All other layouts use
                      the in-body toolbar below. */}
                          {!isModernLayout ? (
                            <div className="flex items-center gap-x-2">
                              {/* Mobile folder tree drawer — only when folder navigation is enabled */}
                              {showFolderTree ? (
                                <div className="flex md:hidden">
                                  <Sheet>
                                    <SheetTrigger asChild>
                                      <button
                                        className={cn(
                                          "lg:hidden",
                                          "text-[var(--viewer-subtle-text)]",
                                        )}
                                      >
                                        <PanelLeftIcon
                                          className="h-5 w-5"
                                          aria-hidden="true"
                                        />
                                      </button>
                                    </SheetTrigger>
                                    <SheetPortal>
                                      <SheetOverlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                                      <SheetPrimitive.Content
                                        className={cn(
                                          "fixed inset-y-0 left-0 z-50 gap-4 bg-background shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out",
                                          "border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-lg",
                                          "m-0 w-[280px] p-0 sm:w-[300px] lg:hidden",
                                        )}
                                      >
                                        <div className="mt-8 h-full space-y-8 overflow-auto px-2 py-3">
                                          <ViewerSurfaceThemeProvider
                                            value={mobileTreeTheme}
                                          >
                                            {showNoBannerTitle ? (
                                              <DataroomNoBannerTitle
                                                name={dataroom.name}
                                                lastUpdatedAt={
                                                  dataroom.lastUpdatedAt
                                                }
                                                showLastUpdated={
                                                  dataroom.showLastUpdated
                                                }
                                                className="mb-3 px-1"
                                              />
                                            ) : null}
                                            <ViewFolderTree
                                              folders={folders}
                                              documents={documents}
                                              setFolderId={setFolderId}
                                              folderId={folderId}
                                              dataroomIndexEnabled={
                                                dataroomIndexEnabled
                                              }
                                            />
                                          </ViewerSurfaceThemeProvider>
                                        </div>
                                        <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
                                          <XIcon className="h-4 w-4" />
                                          <span className="sr-only">Close</span>
                                        </SheetPrimitive.Close>
                                      </SheetPrimitive.Content>
                                    </SheetPortal>
                                  </Sheet>
                                </div>
                              ) : null}

                              <div className="flex min-w-0 flex-1 items-center justify-between gap-x-2">
                                {toolbarBreadcrumbEl}

                                {/* Right cluster: search + buttons. Single inline row on
                            sm+ (matches the historical layout). On narrow
                            mobile we allow wrapping so the buttons drop to a
                            new line instead of overflowing the row — this is
                            the only mobile concession; sm+ is unchanged. */}
                                <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap sm:gap-x-2">
                                  <IntroductionInfoButton />
                                  <SearchBoxPersisted
                                    placeholder={t(
                                      "search.placeholder",
                                      "Search...",
                                    )}
                                    inputClassName="h-9 border-[var(--viewer-control-border)] bg-[var(--viewer-control-bg)] text-[var(--viewer-text)] placeholder:text-[var(--viewer-placeholder)] shadow-sm hover:border-[var(--viewer-control-border-strong)] focus:border-[var(--viewer-control-border-strong)]"
                                    leftIconClassName="text-[var(--viewer-control-icon)]"
                                    clearIconClassName="text-[var(--viewer-control-icon)] hover:text-[var(--viewer-text)]"
                                  />
                                  {enableIndexFile &&
                                    (isPreview || (viewId && viewerId)) && (
                                      <IndexFileDialog
                                        linkId={linkId}
                                        viewId={viewId ?? ""}
                                        dataroomId={dataroom?.id}
                                        viewerId={viewerId}
                                        viewerEmail={viewerEmail}
                                        isPreview={isPreview}
                                        triggerClassName={
                                          viewerThemedTriggerClass
                                        }
                                      />
                                    )}

                                  {viewData?.enableVisitorUpload &&
                                    (isPreview || viewerId) && (
                                      <DocumentUploadModal
                                        linkId={linkId}
                                        dataroomId={dataroom?.id}
                                        viewerId={viewerId ?? ""}
                                        isPreview={isPreview}
                                        folderId={folderId ?? undefined}
                                        folderName={
                                          folderId
                                            ? folders.find(
                                                (f) => f.id === folderId,
                                              )?.name
                                            : undefined
                                        }
                                        allowedFolders={
                                          viewData?.uploadFolderAllowList
                                        }
                                        triggerClassName={
                                          viewerThemedTriggerClass
                                        }
                                      />
                                    )}
                                  {requestListEnabled && (
                                    <RequestListButton
                                      className={viewerThemedTriggerClass}
                                    />
                                  )}
                                  {isNotionLayout ? (
                                    <DataroomTrailingActions
                                      variant="onLight"
                                      isTeamMember={viewData?.isTeamMember}
                                      brand={{
                                        ctaLabel:
                                          (brand as any)?.ctaLabel ?? null,
                                        ctaUrl: (brand as any)?.ctaUrl ?? null,
                                        brandColor: brand?.brandColor ?? null,
                                        accentButtonColor:
                                          (brand as any)?.accentButtonColor ??
                                          null,
                                      }}
                                      conversationsEnabled={
                                        viewData?.conversationsEnabled
                                      }
                                      allowDownload={allowDownload}
                                      allowBulkDownload={allowBulkDownload}
                                      viewerEmail={viewerEmail}
                                      isPreview={isPreview}
                                      onToggleConversations={() =>
                                        window.dispatchEvent(
                                          new CustomEvent(
                                            VIEWER_TOGGLE_CONVERSATIONS_EVENT,
                                          ),
                                        )
                                      }
                                      onOpenDownload={() => {
                                        if (isPreview) {
                                          toast.error(
                                            t(
                                              "navToasts.cannotDownloadPreview",
                                              "You cannot download datarooms in preview mode.",
                                            ),
                                          );
                                          return;
                                        }
                                        if (
                                          !allowDownload ||
                                          !allowBulkDownload
                                        )
                                          return;
                                        if (!viewerEmail) return;
                                        window.dispatchEvent(
                                          new CustomEvent(
                                            VIEWER_OPEN_DOWNLOAD_EVENT,
                                          ),
                                        );
                                      }}
                                    />
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {/* Tabs: Documents / My Uploads. Request List uploads
                              also land here, so show the tab when either visitor
                              upload or a request list is available. */}
                          {(viewData?.enableVisitorUpload ||
                            requestListEnabled) &&
                            hasUploads && (
                            <div
                              className="mt-4 flex items-center gap-1 border-b"
                              style={{
                                borderColor:
                                  viewerSurfaceTheme.palette.panelBorderColor,
                              }}
                            >
                              <button
                                onClick={() => setActiveTab("documents")}
                                className={cn(
                                  "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                                  activeTab === "documents"
                                    ? "border-[var(--viewer-text)] text-[var(--viewer-text)]"
                                    : "border-transparent text-[var(--viewer-subtle-text)] hover:border-[var(--viewer-panel-border-hover)] hover:text-[var(--viewer-text)]",
                                )}
                              >
                                {t("tabs.documents", "Documents")}
                              </button>
                              <button
                                onClick={() => setActiveTab("my-uploads")}
                                className={cn(
                                  "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                                  activeTab === "my-uploads"
                                    ? "border-[var(--viewer-text)] text-[var(--viewer-text)]"
                                    : "border-transparent text-[var(--viewer-subtle-text)] hover:border-[var(--viewer-panel-border-hover)] hover:text-[var(--viewer-text)]",
                                )}
                              >
                                <UploadIcon className="h-3.5 w-3.5" />
                                {t("tabs.myUploads", "My Uploads")}
                                <span
                                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium"
                                  style={{
                                    backgroundColor:
                                      viewerSurfaceTheme.palette.controlBgColor,
                                    color:
                                      viewerSurfaceTheme.palette.mutedTextColor,
                                  }}
                                >
                                  {allUploads.length}
                                </span>
                              </button>
                            </div>
                          )}

                          {/* Search results banner */}
                          {searchQuery && activeTab === "documents" && (
                            <div className="mt-4 rounded-md border border-[var(--viewer-panel-border)] bg-[var(--viewer-control-bg)] px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-medium text-[var(--viewer-muted-text)]">
                                  {t(
                                    "search.results",
                                    'Search results for "{{query}}"',
                                    { query: searchQuery },
                                  )}
                                </div>
                                <div className="text-xs text-[var(--viewer-subtle-text)]">
                                  {t(
                                    "search.resultCount",
                                    "({{count}} results across all folders)",
                                    { count: mixedItems.length },
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {activeTab === "my-uploads" ? (
                            /* My Uploads tab - show all uploads across all folders */
                            <ul
                              role="list"
                              className="-mx-4 space-y-4 overflow-auto p-4"
                            >
                              {allUploads.length === 0 ? (
                                <li className="py-6 text-center text-[var(--viewer-subtle-text)]">
                                  {t(
                                    "empty.noUploads",
                                    'No uploads yet. Upload documents using the "Add Document" button.',
                                  )}
                                </li>
                              ) : (
                                allUploads.map((pendingUpload) => (
                                  <li key={pendingUpload.id}>
                                    <PendingDocumentCard
                                      pendingUpload={pendingUpload}
                                      folders={folders}
                                      linkId={linkId}
                                      showFolderPath
                                      onNavigateToFolder={(id) => {
                                        setFolderId(id);
                                        setActiveTab("documents");
                                      }}
                                    />
                                  </li>
                                ))
                              )}
                            </ul>
                          ) : cardLayout === "GRID" ? (
                            <div className="-mx-4 space-y-4 overflow-auto p-4">
                              {!searchQuery &&
                                filteredPendingUploads.map((pendingUpload) => (
                                  <div key={pendingUpload.id}>
                                    <PendingDocumentCard
                                      pendingUpload={pendingUpload}
                                      linkId={linkId}
                                    />
                                  </div>
                                ))}

                              {mixedItems.length === 0 &&
                              filteredPendingUploads.length === 0 ? (
                                <div className="py-6 text-center text-[var(--viewer-subtle-text)]">
                                  {searchQuery
                                    ? t(
                                        "search.noMatches",
                                        "No documents match your search.",
                                      )
                                    : t("empty.noItems", "No items available.")}
                                </div>
                              ) : (
                                segmentMixedItemsForGrid(mixedItems).map(
                                  (run, runIdx) => (
                                    <ul
                                      key={runIdx}
                                      role="list"
                                      className={
                                        run.kind === "folder"
                                          ? folderGridListClassName
                                          : documentGridListClassName
                                      }
                                    >
                                      {run.items.map((item) => (
                                        <li key={item.id}>
                                          {renderItem(item)}
                                        </li>
                                      ))}
                                    </ul>
                                  ),
                                )
                              )}
                            </div>
                          ) : (
                            /* Documents tab — list / compact layouts */
                            <div
                              className={cn(
                                cardLayout === "COMPACT" &&
                                  "mt-4 border-t border-[var(--viewer-panel-border)]",
                              )}
                            >
                              {cardLayout === "COMPACT" ? (
                                <CompactDataroomListHeader
                                  showUpdatedColumn={compactTableShowUpdated}
                                  showSettingsColumn={
                                    compactListShowsActionsColumn
                                  }
                                  showIndexColumn
                                />
                              ) : null}
                              <ul role="list" className={itemListClassName}>
                                {!searchQuery &&
                                  filteredPendingUploads.map(
                                    (pendingUpload) => (
                                      <li key={pendingUpload.id}>
                                        <PendingDocumentCard
                                          pendingUpload={pendingUpload}
                                          linkId={linkId}
                                        />
                                      </li>
                                    ),
                                  )}

                                {mixedItems.length === 0 &&
                                filteredPendingUploads.length === 0 ? (
                                  <li className="py-6 text-center text-[var(--viewer-subtle-text)]">
                                    {searchQuery
                                      ? t(
                                          "search.noMatches",
                                          "No documents match your search.",
                                        )
                                      : t(
                                          "empty.noItems",
                                          "No items available.",
                                        )}
                                  </li>
                                ) : (
                                  mixedItems.map((item, idx) => (
                                    <li key={item.id}>
                                      {renderItem(item, idx)}
                                    </li>
                                  ))
                                )}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    {showPoweredByBanner ? (
                      <footer className="shrink-0 px-3 md:px-6 lg:px-8 xl:px-14">
                        <div
                          className="border-t py-3"
                          style={{
                            borderColor:
                              viewerSurfaceTheme.palette.panelBorderColor,
                          }}
                        >
                          <div className="flex items-center justify-between gap-4 text-xs text-[var(--viewer-subtle-text)]">
                            <span className="truncate">
                              &copy; {new Date().getFullYear()}
                              {dataroom?.name ? ` ${dataroom.name}` : ""}
                            </span>
                            <a
                              href={`https://www.papermark.com?utm_campaign=poweredby&utm_medium=poweredby&utm_source=papermark-${linkId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="whitespace-nowrap transition-colors hover:text-[var(--viewer-text)]"
                            >
                              {t("shell.secureFooter", "Secured by")}{" "}
                              <span className="font-semibold tracking-tight">
                                Papermark
                              </span>
                            </a>
                          </div>
                        </div>
                      </footer>
                    ) : null}
                  </div>
                </div>
              </ConversationSidebarLayout>
            </ViewerChatLayout>
          </ViewerSurfaceThemeProvider>

          {/* AI Chat Components */}
          <ViewerChatPanel />
          <ViewerChatToggle />
        </ViewerChatProvider>
      </ConversationSidebarProvider>
    </IntroductionProvider>
  );
}
