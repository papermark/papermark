import { Fragment, memo, useCallback, useMemo, useState } from "react";

import { TeamContextType } from "@/context/team-context";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  MeasuringStrategy,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { DefaultPermissionStrategy } from "@prisma/client";
import {
  ArchiveXIcon,
  FileIcon,
  FolderIcon,
  FolderInputIcon,
  XIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

import { moveDataroomDocumentToFolder } from "@/lib/documents/move-dataroom-documents";
import { moveDataroomFolderToFolder } from "@/lib/documents/move-dataroom-folders";
import { useDataroomPermissions } from "@/lib/hooks/use-dataroom-permissions";
import {
  DataroomFolderDocument,
  DataroomFolderWithCount,
  useDataroom,
} from "@/lib/swr/use-dataroom";
import useDataroomGroups from "@/lib/swr/use-dataroom-groups";
import useDataroomPermissionGroups from "@/lib/swr/use-dataroom-permission-groups";
import { useMediaQuery } from "@/lib/utils/use-media-query";

import { useRemoveDataroomItemsModal } from "@/components/datarooms/actions/remove-document-modal";
import DataroomDocumentCard from "@/components/datarooms/dataroom-document-card";
import { SetUnifiedPermissionsModal } from "@/components/datarooms/groups/set-unified-permissions-modal";
import { useDeleteFolderModal } from "@/components/documents/actions/delete-folder-modal";
import { DraggableItem } from "@/components/documents/drag-and-drop/draggable-item";
import { DroppableFolder } from "@/components/documents/drag-and-drop/droppable-folder";
import { EmptyDocuments } from "@/components/documents/empty-document";
import FolderCard from "@/components/documents/folder-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Portal } from "@/components/ui/portal";
import { ButtonTooltip } from "@/components/ui/tooltip";
import {
  useUploadCallbacks,
  useUploadProgress,
} from "@/context/upload-progress-context";

import UploadZone from "@/components/upload-zone";

import { itemsMessage } from "./folders/utils";
import { MoveToDataroomFolderModal } from "./move-dataroom-folder-modal";

type FolderOrDocument =
  | (DataroomFolderWithCount & { itemType: "folder" })
  | (DataroomFolderDocument & { itemType: "document" });

export function DataroomItemsList({
  mixedItems,
  teamInfo,
  folderPathName,
  dataroomId,
  folderCount,
  documentCount,
}: {
  mixedItems: FolderOrDocument[] | [];
  teamInfo: TeamContextType | null;
  folderPathName?: string[];
  dataroomId: string;
  folderCount: number;
  documentCount: number;
}) {
  const { viewerGroups } = useDataroomGroups();
  const { permissionGroups } = useDataroomPermissionGroups();
  const { dataroom } = useDataroom();
  const { isMobile } = useMediaQuery();
  const { applyPermissions } = useDataroomPermissions();

  const { setRejectedFiles, cancelledItemIdsRef } = useUploadProgress();
  const {
    onTraversalStart,
    onUploadBatchStart,
    onUploadBatchUpdate,
    onUploadRejected,
    onUploadAborted,
  } = useUploadCallbacks();

  const [showGroupPermissions, setShowGroupPermissions] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<
    {
      documentId: string;
      dataroomDocumentId: string;
      fileName: string;
    }[]
  >([]);

  const [moveFolderOpen, setMoveFolderOpen] = useState<boolean>(false);

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  // forDoc
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [draggedDocument, setDraggedDocument] =
    useState<FolderOrDocument | null>(null);

  // forFolder
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [draggedFolder, setDraggedFolder] = useState<FolderOrDocument | null>(
    null,
  );
  const [parentFolderId, setParentFolderId] = useState<string>("");
  const [isOverFolder, setIsOverFolder] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const { setDeleteModalOpen, setFolderToDelete, DeleteFolderModal } =
    useDeleteFolderModal(teamInfo, true, dataroomId);

  const handleDeleteFolder = useCallback(
    (folderId: string) => {
      const folderToDelete = mixedItems.find(
        (f) => f.id === folderId && f.itemType === "folder",
      );
      if (folderToDelete && folderToDelete.itemType === "folder") {
        const { itemType, ...folder } = folderToDelete;
        setFolderToDelete(folder);
        setDeleteModalOpen(true);
        setSelectedFolders((prev) => prev.filter((id) => id !== folderId));
      }
    },
    [mixedItems, setFolderToDelete, setDeleteModalOpen, setSelectedFolders],
  );


  const { setShowRemoveDataroomItemModal, RemoveDataroomItemModal } =
    useRemoveDataroomItemsModal({
      documentIds: selectedDocuments,
      setSelectedDocuments: setSelectedDocuments,
      dataroomId,
      folderIds: selectedFolders,
      setSelectedFolders,
    });

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
  );

  const selectedDocumentsLength = useMemo(
    () => selectedDocuments && selectedDocuments.length,
    [selectedDocuments],
  );

  const selectedFoldersLength = useMemo(
    () => selectedFolders && selectedFolders.length,
    [selectedFolders],
  );

  const handleSelect = useCallback(
    (id: string, type: "document" | "folder") => {
      if (type === "folder") {
        setSelectedFolders((prev) =>
          prev.includes(id)
            ? prev.filter((docId) => docId !== id)
            : [...prev, id],
        );
      } else {
        setSelectedDocuments((prev) =>
          prev.includes(id)
            ? prev.filter((docId) => docId !== id)
            : [...prev, id],
        );
      }
    },
    [],
  );
  const handleDragForType = useCallback(
    (
      itemId: string,
      items: { id: string }[],
      setDraggedItem: (item: any) => void,
      selectedItems: string[],
      setSelectedItems: (items: string[]) => void,
    ) => {
      if (!items.length) return;

      const draggedItem = items.find((item) => item.id === itemId) ?? null;
      setDraggedItem(draggedItem);

      const itemIndex = items.findIndex((item) => item.id === itemId);
      const isSelected = selectedItems.includes(itemId);

      let yOffset = 0;
      if (isSelected) {
        const firstSelectedIndex = items.findIndex((item) =>
          selectedItems.includes(item.id),
        );
        yOffset = (itemIndex - firstSelectedIndex) * 80; // Adjust height accordingly
      }

      setDragOffset({ x: 0, y: yOffset });

      if (!isSelected) {
        setSelectedItems([...selectedItems, itemId]);
      }
    },
    [],
  );
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setIsDragging(true);
      setParentFolderId(event.active.data.current?.parentFolderId);
      const { type } = event.active.data.current ?? {};
      const itemId = event.active.id as string;

      if (!type) return;

      const isDocument = type === "document";
      const filteredItems = mixedItems.filter((item) => item.itemType === type);

      handleDragForType(
        itemId,
        filteredItems,
        isDocument ? setDraggedDocument : setDraggedFolder,
        isDocument ? selectedDocuments : selectedFolders,
        isDocument ? setSelectedDocuments : setSelectedFolders,
      );
    },
    [
      mixedItems,
      setIsDragging,
      setDraggedDocument,
      setDraggedFolder,
      selectedDocuments,
      selectedFolders,
      setSelectedDocuments,
      setSelectedFolders,
      setParentFolderId,
      handleDragForType,
    ],
  );

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;

    if (!over) return;

    const overType = over.data.current?.type;
    if (overType === "folder") {
      setIsOverFolder(true);
    } else {
      setIsOverFolder(false);
    }
  };

  const moveDocumentsAndFolders = async ({
    documentsToMove,
    foldersToMove,
    overId,
    folderPathName,
    teamId,
    selectedFolderPath,
  }: {
    documentsToMove: string[];
    foldersToMove: string[];
    overId: UniqueIdentifier;
    folderPathName: string[] | undefined;
    teamId: string;
    selectedFolderPath: string;
  }) => {
    return new Promise(async (resolve, reject) => {
      try {
        if (documentsToMove && documentsToMove.length > 0) {
          await moveDataroomDocumentToFolder({
            documentIds: documentsToMove,
            folderId: overId.toString(),
            folderPathName,
            dataroomId,
            teamId: teamId,
            folderIds: foldersToMove,
          });
        }
        if (foldersToMove && foldersToMove.length > 0) {
          await moveDataroomFolderToFolder({
            folderIds: foldersToMove,
            folderPathName: folderPathName ? folderPathName : undefined,
            teamId: teamId,
            selectedFolder: overId.toString(),
            dataroomId: dataroomId,
            selectedFolderPath: selectedFolderPath,
          });
        }

        resolve("Successfully moved documents and folders.");
      } catch (error) {
        reject(
          error instanceof Error
            ? error.message
            : "Failed to move documents and folders.",
        );
      }
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setIsDragging(false);
    const { active, over } = event;

    setDraggedDocument(null);
    setDraggedFolder(null);

    if (!over) return;

    const activeId = active.id;
    const overId = over.id;
    if (selectedFolders.includes(overId.toString())) {
      return toast.error(
        "Can not move folder and documents into selected folders",
      );
    }
    const isActiveADocument = active.data.current?.type === "document";
    const isActiveAFolder = active.data.current?.type === "folder";
    const isOverAFolder = over.data.current?.type === "folder";
    if (activeId === overId) return;
    if (isActiveADocument && !isOverAFolder) return;
    if (isActiveAFolder && !isOverAFolder) return;

    // Move the document(s) to the new folder
    const documentsToMove =
      selectedDocumentsLength > 0 ? selectedDocuments : [];
    const foldersToMove = selectedFoldersLength > 0 ? selectedFolders : [];
    toast.promise(
      moveDocumentsAndFolders({
        documentsToMove: documentsToMove,
        foldersToMove: foldersToMove,
        overId: overId,
        folderPathName: folderPathName,
        teamId: teamInfo?.currentTeam?.id!,
        selectedFolderPath: over.data.current?.path,
      }),
      {
        loading: itemsMessage(documentsToMove, foldersToMove, "Moving"),
        success: () =>
          itemsMessage(documentsToMove, foldersToMove, "Successfully moved"),
        error: (err) => err,
      },
    );
    setSelectedDocuments([]);
    setSelectedFolders([]);
    setIsOverFolder(false);
  };

  const renderItem = (item: FolderOrDocument) => {
    const itemId = `${item.itemType}-${item.id}`;

    if (isMobile) {
      return (
        <Fragment key={itemId}>
          {item.itemType === "folder" ? (
            <FolderCard
              key={itemId}
              folder={item}
              teamInfo={teamInfo}
              isDataroom={!!dataroomId}
              dataroomId={dataroomId}
              onDelete={handleDeleteFolder}
            />
          ) : (
            <DataroomDocumentCard
              key={itemId}
              document={item as DataroomFolderDocument}
              teamInfo={teamInfo}
              dataroomId={dataroomId}
            />
          )}
        </Fragment>
      );
    }

    return (
      <Fragment key={itemId}>
        {item.itemType === "folder" ? (
          <DroppableFolder
            key={itemId}
            id={item.id}
            disabledFolder={selectedFolders}
            path={item.path}
          >
            <DraggableItem
              key={item.id}
              id={item.id}
              isSelected={selectedFolders.includes(item.id)}
              onSelect={(id, type) => {
                handleSelect(id, type);
              }}
              isDraggingSelected={isDragging}
              type="folder"
            >
              <FolderCard
                folder={item}
                teamInfo={teamInfo}
                isDataroom={!!dataroomId}
                dataroomId={dataroomId}
                isSelected={selectedFolders.includes(item.id)}
                isDragging={isDragging && selectedFolders.includes(item.id)}
                onDelete={handleDeleteFolder}
              />
            </DraggableItem>
          </DroppableFolder>
        ) : (
          <DraggableItem
            key={itemId}
            id={item.id}
            isSelected={selectedDocuments.includes(item.id)}
            onSelect={(id, type) => {
              handleSelect(id, type);
            }}
            isDraggingSelected={isDragging}
            type="document"
          >
            <DataroomDocumentCard
              document={item as DataroomFolderDocument}
              teamInfo={teamInfo}
              dataroomId={dataroomId}
              isDragging={isDragging && selectedDocuments.includes(item.id)}
            />
          </DraggableItem>
        )}
      </Fragment>
    );
  };
  const resetSelection = () => {
    setSelectedDocuments([]);
    setSelectedFolders([]);
  };

  const HeaderContent = memo(() => {
    if (selectedDocumentsLength > 0 || selectedFoldersLength > 0) {
      const totalItems = folderCount + documentCount;
      const isAllSelected =
        totalItems === selectedDocumentsLength + selectedFoldersLength;

      const handleSelectAll = () => {
        if (isAllSelected) {
          resetSelection();
        } else {
          const allDocumentIds = mixedItems
            .filter((item) => item.itemType === "document")
            .map((doc) => doc.id);
          const allFolderIds = mixedItems
            .filter((item) => item.itemType === "folder")
            .map((folder) => folder.id);
          setSelectedDocuments(allDocumentIds);
          setSelectedFolders(allFolderIds);
        }
      };

      return (
        <div className="mb-2 flex items-center gap-x-1 rounded-3xl bg-gray-100 text-sm text-foreground dark:bg-gray-800">
          <div className="ml-5 flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-200 hover:dark:bg-gray-700">
            <ButtonTooltip
              content={isAllSelected ? "Deselect all" : "Select all"}
            >
              <Checkbox
                id="select-all"
                checked={isAllSelected}
                onCheckedChange={handleSelectAll}
                className="h-5 w-5"
                aria-label={isAllSelected ? "Deselect all" : "Select all"}
              />
            </ButtonTooltip>
          </div>
          <ButtonTooltip content="Clear selection">
            <Button
              onClick={resetSelection}
              className="mx-1.5 my-1 size-8 rounded-full hover:bg-gray-200 hover:dark:bg-gray-700"
              variant="ghost"
              size="icon"
            >
              <XIcon className="h-5 w-5" />
            </Button>
          </ButtonTooltip>
          {selectedDocumentsLength ? (
            <div className="mr-2 tabular-nums">
              {selectedDocumentsLength} document
              {selectedDocumentsLength > 1 ? "s" : ""} selected
            </div>
          ) : null}
          {selectedFoldersLength ? (
            <div className="mr-2 tabular-nums">
              {selectedFoldersLength} folder
              {selectedFoldersLength > 1 ? "s" : ""} selected
            </div>
          ) : null}
          <ButtonTooltip content="Move">
            <Button
              onClick={() => setMoveFolderOpen(true)}
              className="mx-1.5 my-1 size-8 rounded-full hover:bg-gray-200 hover:dark:bg-gray-700"
              variant="ghost"
              size="icon"
            >
              <FolderInputIcon className="h-5 w-5" />
            </Button>
          </ButtonTooltip>
          <ButtonTooltip content="Remove">
            <Button
              onClick={() => setShowRemoveDataroomItemModal(true)}
              className="mx-1.5 my-1 size-8 rounded-full hover:bg-destructive hover:text-destructive-foreground"
              variant="ghost"
              size="icon"
            >
              <ArchiveXIcon className="h-5 w-5" />
            </Button>
          </ButtonTooltip>
        </div>
      );
    } else {
      return (
        <div className="mb-2 flex min-h-10 items-center gap-x-2">
          {folderCount > 0 ? (
            <p className="flex items-center gap-x-1 text-sm text-gray-400">
              <FolderIcon className="h-5 w-5" />
              <span>
                {folderCount} folder{folderCount > 1 ? "s" : ""}
              </span>
            </p>
          ) : null}
          {documentCount > 0 ? (
            <p className="flex items-center gap-x-1 text-sm text-gray-400">
              <FileIcon className="h-5 w-5" />
              <span>
                {documentCount} document{documentCount > 1 ? "s" : ""}
              </span>
            </p>
          ) : null}
        </div>
      );
    }
  });
  HeaderContent.displayName = "HeaderContent";

  const handleUploadSuccess = (
    files: {
      fileName: string;
      documentId: string;
      dataroomDocumentId: string;
    }[],
  ) => {
    // Check if there are any groups to apply permissions to
    const hasAnyGroups =
      (viewerGroups && viewerGroups.length > 0) ||
      (permissionGroups && permissionGroups.length > 0);

    if (!hasAnyGroups) return;

    const documentIds = files.map((file) => file.documentId);
    const strategy =
      dataroom?.defaultPermissionStrategy ||
      DefaultPermissionStrategy.INHERIT_FROM_PARENT;

    if (strategy === DefaultPermissionStrategy.ASK_EVERY_TIME) {
      setShowGroupPermissions(true);
      setUploadedFiles(files);
    } else if (strategy === DefaultPermissionStrategy.INHERIT_FROM_PARENT) {
      const isRootLevel = !folderPathName || folderPathName.length === 0;

      applyPermissions(
        dataroomId,
        documentIds,
        "INHERIT_FROM_PARENT",
        isRootLevel ? undefined : folderPathName?.join("/"),
        (message: string) => toast.error(message),
      ).catch((error: any) => {
        console.error("Failed to apply permissions:", error);
        toast.error("Failed to apply permissions");
      });
    }
    // strategy === DefaultPermissionStrategy.HIDDEN_BY_DEFAULT - do nothing
  };

  return (
    <>
      <UploadZone
        folderPathName={folderPathName?.join("/")}
        onTraversalStart={onTraversalStart}
        onUploadBatchStart={onUploadBatchStart}
        onUploadBatchUpdate={onUploadBatchUpdate}
        onUploadRejected={onUploadRejected}
        onUploadAborted={onUploadAborted}
        onUploadSuccess={handleUploadSuccess}
        setRejectedFiles={setRejectedFiles}
        cancelledItemIdsRef={cancelledItemIdsRef}
        dataroomId={dataroomId}
        dataroomName={dataroom?.name}
        disabled={dataroom?.isFrozen ?? false}
      >
        {isMobile ? (
          <div>
            <ul role="list" className="space-y-4">
              {mixedItems.map((item) => (
                <li key={`${item.itemType}-${item.id}`}>{renderItem(item)}</li>
              ))}
            </ul>
            <Portal containerId={"documents-header-count"}>
              <HeaderContent />
            </Portal>
            {mixedItems.length === 0 && (
              <div className="flex h-full justify-center">
                <EmptyDocuments isDataroom={true} />
              </div>
            )}
          </div>
        ) : (
          <>
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setIsOverFolder(false)}
              measuring={{
                droppable: {
                  strategy: MeasuringStrategy.Always,
                },
              }}
            >
              <ul role="list" className="space-y-4">
                {mixedItems.map((item) => (
                  <li key={`${item.itemType}-${item.id}`}>
                    {renderItem(item)}
                  </li>
                ))}
              </ul>

              <Portal>
                <DragOverlay className="cursor-default">
                  <motion.div
                    initial={{ scale: 1, opacity: 1 }}
                    animate={{ scale: 0.9, opacity: 0.95 }}
                    exit={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.2 }}
                    className="relative"
                    style={{ transform: `translateY(${dragOffset.y}px)` }}
                  >
                    {draggedDocument ? (
                      <DataroomDocumentCard
                        document={draggedDocument as DataroomFolderDocument}
                        teamInfo={teamInfo}
                        dataroomId={dataroomId}
                      />
                    ) : null}
                    {draggedFolder && draggedFolder.itemType === "folder" ? (
                      <FolderCard
                        folder={draggedFolder}
                        teamInfo={teamInfo}
                        isDataroom={!!dataroomId}
                        dataroomId={dataroomId}
                        onDelete={handleDeleteFolder}
                      />
                    ) : null}
                    {selectedDocumentsLength + selectedFoldersLength > 1 ? (
                      <div className="absolute -right-4 -top-4 rounded-full border border-border bg-foreground px-4 py-2">
                        <span className="text-sm font-semibold text-background">
                          {selectedDocumentsLength + selectedFoldersLength}
                        </span>
                      </div>
                    ) : null}
                  </motion.div>
                </DragOverlay>
              </Portal>

              <Portal containerId={"documents-header-count"}>
                <HeaderContent />
              </Portal>

              {mixedItems.length === 0 && (
                <div className="flex h-full justify-center">
                  <EmptyDocuments isDataroom={true} />
                </div>
              )}
            </DndContext>
            {moveFolderOpen ? (
              <MoveToDataroomFolderModal
                open={moveFolderOpen}
                setOpen={setMoveFolderOpen}
                setSelectedDocuments={setSelectedDocuments}
                documentIds={selectedDocuments}
                dataroomId={dataroomId}
                folderIds={selectedFolders}
                folderParentId={parentFolderId}
                setSelectedFoldersId={setSelectedFolders}
              />
            ) : null}
            <RemoveDataroomItemModal />
          </>
        )}
      </UploadZone>

      {showGroupPermissions && dataroomId && (
        <SetUnifiedPermissionsModal
          open={showGroupPermissions}
          setOpen={setShowGroupPermissions}
          dataroomId={dataroomId}
          uploadedFiles={uploadedFiles}
          onComplete={() => {
            setShowGroupPermissions(false);
            setUploadedFiles([]);
          }}
        />
      )}
      <DeleteFolderModal />
    </>
  );
}
