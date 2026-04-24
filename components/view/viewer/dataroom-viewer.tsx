import { useRouter } from "next/router";

import { useEffect, useMemo, useState } from "react";
import React from "react";

import { ViewerChatPanel } from "@/ee/features/ai/components/viewer-chat-panel";
import {
  ViewerChatLayout,
  ViewerChatProvider,
} from "@/ee/features/ai/components/viewer-chat-provider";
import { ViewerChatToggle } from "@/ee/features/ai/components/viewer-chat-toggle";
import {
  DataroomBrand,
  DataroomFolder,
  PermissionGroupAccessControls,
  ViewerGroupAccessControls,
} from "@prisma/client";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { PanelLeftIcon, UploadIcon, XIcon } from "lucide-react";

import { usePendingUploads } from "@/context/pending-uploads-context";
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
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetOverlay,
  SheetPortal,
  SheetTrigger,
} from "@/components/ui/sheet";

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
        className="capitalize text-[var(--viewer-text)]"
        style={HIERARCHICAL_DISPLAY_STYLE}
      >
        {displayName}
      </BreadcrumbPage>
    );
  }

  return (
    <BreadcrumbLink
      onClick={() => setFolderId(folder.id)}
      className="cursor-pointer capitalize text-[var(--viewer-muted-text)] hover:text-[var(--viewer-text)]"
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
}) {
  const { documents, folders, allowBulkDownload } = dataroom as {
    documents: DataroomDocument[];
    folders: DataroomFolder[];
    allowBulkDownload: boolean;
  };

  const router = useRouter();
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

  const allDocumentsCanDownload = useMemo(() => {
    if (!allowDownload) return false;
    if (!documents || documents.length === 0) return false;

    return documents.some((doc) => {
      if (doc.versions[0].type === "notion") return false;
      const accessControl = accessControls.find(
        (access) => access.itemId === doc.dataroomDocumentId,
      );
      return accessControl?.canDownload ?? true;
    });
  }, [documents, accessControls, allowDownload]);

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

  // create a mixedItems array with folders and documents of the current folder and memoize it
  const mixedItems = useMemo(() => {
    // If there's a search query, filter documents by name across all folders
    if (searchQuery) {
      return (documents || [])
        .filter((doc) => doc.name.toLowerCase().includes(searchQuery))
        .map((doc) => {
          const accessControl = accessControls.find(
            (access) => access.itemId === doc.dataroomDocumentId,
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

    const mixedItems: FolderOrDocument[] = [
      ...(folders || [])
        .filter((folder) => folder.parentId === folderId)
        .map((folder) => {
          const folderDocuments = documents.filter(
            (doc) => doc.folderId === folder.id,
          );

          // Get pre-calculated effective updatedAt
          const effectiveUpdatedAt =
            folderEffectiveUpdatedAt.get(folder.id) ||
            new Date(folder.updatedAt);

          const allDocumentsCanDownload =
            folderDocuments.length === 0 || // Allow download for empty folders
            folderDocuments.every((doc) => {
              const accessControl = accessControls.find(
                (access) => access.itemId === doc.dataroomDocumentId,
              );
              return (
                (accessControl?.canDownload ?? true) &&
                doc.versions[0].type !== "notion"
              );
            });

          return {
            ...folder,
            updatedAt: effectiveUpdatedAt,
            itemType: "folder",
            allowDownload: allowDownload && allDocumentsCanDownload,
          };
        }),
      ...(documents || [])
        .filter((doc) => doc.folderId === folderId)
        .map((doc) => {
          const accessControl = accessControls.find(
            (access) => access.itemId === doc.dataroomDocumentId,
          );

          return {
            ...doc,
            itemType: "document",
            canDownload:
              (accessControl?.canDownload ?? true) &&
              doc.versions[0].type !== "notion",
          };
        }),
    ];

    return sortByIndexThenName(mixedItems);
  }, [
    folders,
    documents,
    folderId,
    accessControls,
    allowDownload,
    folderEffectiveUpdatedAt,
    searchQuery,
  ]);

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

      const matchingDocument = documents.find((doc) => doc.id === upload.documentId);
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

  const renderItem = (item: FolderOrDocument) => {
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
      />
      <ViewerSurfaceThemeProvider value={viewerSurfaceTheme}>
        <ViewerChatLayout>
          <div
            className="relative flex flex-1 items-center overflow-hidden bg-white dark:bg-black"
            style={
              viewerSurfaceTheme.palette.backgroundColor
                ? { backgroundColor: viewerSurfaceTheme.palette.backgroundColor }
                : undefined
            }
          >
            <div
              className="relative mx-auto flex h-full w-full items-start justify-center"
              style={
                {
                  "--viewer-text": viewerSurfaceTheme.palette.textColor,
                  "--viewer-muted-text": viewerSurfaceTheme.palette.mutedTextColor,
                  "--viewer-subtle-text":
                    viewerSurfaceTheme.palette.subtleTextColor,
                  "--viewer-panel-bg": viewerSurfaceTheme.palette.panelBgColor,
                  "--viewer-panel-bg-hover":
                    viewerSurfaceTheme.palette.panelHoverBgColor,
                  "--viewer-panel-border":
                    viewerSurfaceTheme.palette.panelBorderColor,
                  "--viewer-panel-border-hover":
                    viewerSurfaceTheme.palette.panelBorderHoverColor,
                  "--viewer-control-bg": viewerSurfaceTheme.palette.controlBgColor,
                  "--viewer-control-border":
                    viewerSurfaceTheme.palette.controlBorderColor,
                  "--viewer-control-border-strong":
                    viewerSurfaceTheme.palette.controlBorderStrongColor,
                  "--viewer-control-icon":
                    viewerSurfaceTheme.palette.controlIconColor,
                  "--viewer-placeholder":
                    viewerSurfaceTheme.palette.controlPlaceholderColor,
                } as React.CSSProperties
              }
            >
            {/* Tree view */}
            <div
              className="hidden h-full shrink-0 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-4 md:block md:px-4 md:pt-6 lg:px-6 lg:pt-9 xl:px-8"
              style={{
                // Fluid sidebar: grows with viewport but clamped to sensible
                // bounds so the tree fills available space without feeling
                // cramped on narrow screens or stretched on ultra-wide ones.
                width: "clamp(260px, 28vw, 440px)",
              }}
            >
              <ViewFolderTree
                folders={folders}
                documents={documents}
                setFolderId={setFolderId}
                folderId={folderId}
                dataroomIndexEnabled={dataroomIndexEnabled}
              />
            </div>

            {/* Detail view */}
            <ScrollArea
              showScrollbar
              className="h-full flex-grow overflow-auto"
            >
              <div
                className="h-full px-3 pb-4 pt-4 md:px-6 md:pt-6 lg:px-8 lg:pt-9 xl:px-14"
              >
                <div className="flex items-center gap-x-2">
                  {/* sidebar for mobile */}
                  <div className="flex md:hidden">
                    <Sheet>
                      <SheetTrigger asChild>
                        <button className={cn(
                          "lg:hidden",
                          "text-[var(--viewer-subtle-text)]",
                        )}>
                          <PanelLeftIcon
                            className="h-5 w-5"
                            aria-hidden="true"
                          />
                        </button>
                      </SheetTrigger>
                      <SheetPortal>
                        <SheetOverlay className="fixed top-[35dvh] z-50 bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                        <SheetPrimitive.Content
                          className={cn(
                            "fixed top-[35dvh] z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out",
                            "left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-lg",
                            "m-0 w-[280px] p-0 sm:w-[300px] lg:hidden",
                          )}
                        >
                          <div className="mt-8 h-full space-y-8 overflow-auto px-2 py-3">
                            <ViewerSurfaceThemeProvider value={mobileTreeTheme}>
                              <ViewFolderTree
                                folders={folders}
                                documents={documents}
                                setFolderId={setFolderId}
                                folderId={folderId}
                                dataroomIndexEnabled={dataroomIndexEnabled}
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

                  <div className="flex flex-1 items-center justify-between gap-x-2">
                    <Breadcrumb>
                      <BreadcrumbList className="text-[var(--viewer-muted-text)]">
                        <BreadcrumbItem key={"root"}>
                          <BreadcrumbLink
                            onClick={() => setFolderId(null)}
                            className="cursor-pointer text-[var(--viewer-muted-text)] hover:text-[var(--viewer-text)]"
                          >
                            Home
                          </BreadcrumbLink>
                        </BreadcrumbItem>

                        {breadcrumbFolders.map((folder, index) => (
                          <React.Fragment key={folder.id}>
                            <BreadcrumbSeparator
                              className="text-[var(--viewer-subtle-text)]"
                            />
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

                    <div className="flex items-center gap-x-2">
                      <IntroductionInfoButton />
                      <SearchBoxPersisted
                        inputClassName="h-9 border-[var(--viewer-control-border)] bg-[var(--viewer-control-bg)] text-[var(--viewer-text)] placeholder:text-[var(--viewer-placeholder)] shadow-sm hover:border-[var(--viewer-control-border-strong)] focus:border-[var(--viewer-control-border-strong)]"
                        leftIconClassName="text-[var(--viewer-control-icon)]"
                        clearIconClassName="text-[var(--viewer-control-icon)] hover:text-[var(--viewer-text)]"
                      />
                      {enableIndexFile && viewId && viewerId && (
                        <IndexFileDialog
                          linkId={linkId}
                          viewId={viewId}
                          dataroomId={dataroom?.id}
                          viewerId={viewerId}
                          viewerEmail={viewerEmail}
                        />
                      )}

                      {viewData?.enableVisitorUpload && viewerId && (
                        <DocumentUploadModal
                          linkId={linkId}
                          dataroomId={dataroom?.id}
                          viewerId={viewerId}
                          folderId={folderId ?? undefined}
                          folderName={
                            folderId
                              ? folders.find((f) => f.id === folderId)?.name
                              : undefined
                          }
                          allowedFolders={viewData?.uploadFolderAllowList}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Tabs: Documents / My Uploads */}
                {viewData?.enableVisitorUpload && hasUploads && (
                  <div
                    className="mt-4 flex items-center gap-1 border-b"
                    style={{ borderColor: viewerSurfaceTheme.palette.panelBorderColor }}
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
                      Documents
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
                      My Uploads
                      <span
                        className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium"
                        style={{
                          backgroundColor: viewerSurfaceTheme.palette.controlBgColor,
                          color: viewerSurfaceTheme.palette.mutedTextColor,
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
                        Search results for &quot;{searchQuery}&quot;
                      </div>
                      <div className="text-xs text-[var(--viewer-subtle-text)]">
                        ({mixedItems.length} result
                        {mixedItems.length !== 1 ? "s" : ""} across all folders)
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
                        No uploads yet. Upload documents using the &quot;Add
                        Document&quot; button.
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
                ) : (
                  /* Documents tab - normal folder view */
                  <ul
                    role="list"
                    className="-mx-4 space-y-4 overflow-auto p-4"
                  >
                    {!searchQuery &&
                      filteredPendingUploads.map((pendingUpload) => (
                        <li key={pendingUpload.id}>
                          <PendingDocumentCard
                            pendingUpload={pendingUpload}
                            linkId={linkId}
                          />
                        </li>
                      ))}

                    {mixedItems.length === 0 &&
                    filteredPendingUploads.length === 0 ? (
                      <li className="py-6 text-center text-[var(--viewer-subtle-text)]">
                        {searchQuery
                          ? "No documents match your search."
                          : "No items available."}
                      </li>
                    ) : (
                      mixedItems.map((item) => (
                        <li key={item.id}>{renderItem(item)}</li>
                      ))
                    )}
                  </ul>
                )}
              </div>
              <ScrollBar orientation="vertical" />
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
          </div>
        </ViewerChatLayout>
      </ViewerSurfaceThemeProvider>

      {/* AI Chat Components */}
      <ViewerChatPanel />
      <ViewerChatToggle />
      </ViewerChatProvider>
    </IntroductionProvider>
  );
}
