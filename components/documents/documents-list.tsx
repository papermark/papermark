import { memo, useCallback, useMemo, useState } from "react";
import React from "react";

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
import {
  EyeOffIcon,
  FileIcon,
  FolderIcon,
  FolderInputIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { mutate } from "swr";

import { moveDocumentToFolder } from "@/lib/documents/move-documents";
import { moveFolderToFolder } from "@/lib/documents/move-folder";
import { DataroomFolderWithCount } from "@/lib/swr/use-dataroom";
import { FolderWithCount, FolderWithCountAndPath } from "@/lib/swr/use-documents";
import { DocumentWithLinksAndLinkCountAndViewCount } from "@/lib/types";
import { useMediaQuery } from "@/lib/utils/use-media-query";

import {
  useUploadCallbacks,
  useUploadProgress,
} from "@/context/upload-progress-context";

import { Skeleton } from "@/components/ui/skeleton";
import UploadZone from "@/components/upload-zone";

import { itemsMessage } from "../datarooms/folders/utils";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Portal } from "../ui/portal";
import { ButtonTooltip } from "../ui/tooltip";
import { useDeleteDocumentsAndFoldersModal } from "./actions/delete-documents-modal";
import { useDeleteFolderModal } from "./actions/delete-folder-modal";
import DocumentCard from "./document-card";
import { DraggableItem } from "./drag-and-drop/draggable-item";
import { DroppableFolder } from "./drag-and-drop/droppable-folder";
import { EmptyDocuments } from "./empty-document";
import FolderCard from "./folder-card";
import { MoveToFolderModal, TSelectedFolder } from "./move-folder-modal";


export function DocumentsList({
  folders,
  documents,
  teamInfo,
  folderPathName,
  loading,
  foldersLoading,
}: {
  folders: FolderWithCount[] | FolderWithCountAndPath[] | undefined;
  documents: DocumentWithLinksAndLinkCountAndViewCount[] | undefined;
  teamInfo: TeamContextType | null;
  folderPathName?: string[];
  loading: boolean;
  foldersLoading: boolean;
}) {
  const { isMobile } = useMediaQuery();
  const { setRejectedFiles, cancelledItemIdsRef } = useUploadProgress();
  const {
    onTraversalStart,
    onUploadBatchStart,
    onUploadBatchUpdate,
    onUploadRejected,
    onUploadAborted,
  } = useUploadCallbacks();

  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [draggedDocument, setDraggedDocument] =
    useState<DocumentWithLinksAndLinkCountAndViewCount | null>(null);

  //forFolder
  const [draggedFolder, setDraggedFolder] = useState<
    FolderWithCount | DataroomFolderWithCount | null
  >(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isOverFolder, setIsOverFolder] = useState<boolean>(false);
  const [parentFolderId, setParentFolderId] = useState<string>("");
  const [moveFolderOpen, setMoveFolderOpen] = useState<boolean>(false);

  const { setDeleteModalOpen, setFolderToDelete, DeleteFolderModal } =
    useDeleteFolderModal(teamInfo);

  const handleDeleteFolder = useCallback(
    (folderId: string) => {
      const folderToDelete = folders?.find((f) => f.id === folderId);
      if (folderToDelete) {
        setFolderToDelete(folderToDelete);
        setDeleteModalOpen(true);
        setSelectedFolders((prev) => prev.filter((id) => id !== folderId));
      }
    },
    [folders, setFolderToDelete, setDeleteModalOpen, setSelectedFolders],
  );

  const { setShowDeleteItemsModal, DeleteItemsModal } =
    useDeleteDocumentsAndFoldersModal({
      documentIds: selectedDocuments,
      setSelectedDocuments,
      folderIds: selectedFolders,
      setSelectedFolder: setSelectedFolders,
    });

  const totalSelectedItem = [...selectedDocuments, ...selectedFolders].length;

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
      items: { id: string }[] | undefined,
      setDraggedItem: (item: any) => void,
      selectedItems: string[],
      setSelectedItems: (items: string[]) => void,
    ) => {
      if (!items) return;

      const draggedItem = items.find((item) => item.id === itemId) ?? null;
      setDraggedItem(draggedItem);

      const itemIndex = items.findIndex((item) => item.id === itemId);
      const isSelected = selectedItems.includes(itemId);

      let yOffset = 0;
      if (isSelected) {
        const firstSelectedIndex = items.findIndex((item) =>
          selectedItems.includes(item.id),
        );
        yOffset = (itemIndex - firstSelectedIndex) * 80; // Adjust based on actual height
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

      if (type === "document") {
        handleDragForType(
          itemId,
          documents,
          setDraggedDocument,
          selectedDocuments,
          setSelectedDocuments,
        );
      }

      if (type === "folder") {
        handleDragForType(
          itemId,
          folders,
          setDraggedFolder,
          selectedFolders,
          setSelectedFolders,
        );
      }
    },
    [handleDragForType, documents, folders, selectedDocuments, selectedFolders],
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
          await moveDocumentToFolder({
            documentIds: documentsToMove,
            folderId: overId.toString(),
            folderPathName,
            teamId: teamId,
            folderIds: foldersToMove,
          });
        }
        if (foldersToMove && foldersToMove.length > 0) {
          await moveFolderToFolder({
            folderIds: foldersToMove,
            folderPathName: folderPathName ? folderPathName : undefined,
            teamId: teamId,
            selectedFolder: overId.toString(),
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
    // Move the folder(s) to the new folder
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


  const resetSelection = () => {
    setSelectedDocuments([]);
    setSelectedFolders([]);
  };

  const [isHiding, setIsHiding] = useState(false);

  const handleBulkHide = useCallback(async () => {
    if (selectedDocuments.length === 0 && selectedFolders.length === 0) return;

    setIsHiding(true);

    try {
      const promises: Promise<Response>[] = [];

      // Hide documents
      if (selectedDocuments.length > 0) {
        promises.push(
          fetch(`/api/teams/${teamInfo?.currentTeam?.id}/documents/hide`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              documentIds: selectedDocuments,
              hidden: true,
            }),
          }),
        );
      }

      // Hide folders (cascades to children)
      if (selectedFolders.length > 0) {
        promises.push(
          fetch(`/api/teams/${teamInfo?.currentTeam?.id}/folders/hide`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              folderIds: selectedFolders,
              hidden: true,
            }),
          }),
        );
      }

      const results = await Promise.all(promises);

      // Check for errors
      for (const res of results) {
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to hide items");
        }
      }

      // Revalidate data
      mutate(`/api/teams/${teamInfo?.currentTeam?.id}/folders?root=true`);
      mutate(`/api/teams/${teamInfo?.currentTeam?.id}/folders`);
      mutate(`/api/teams/${teamInfo?.currentTeam?.id}/documents`);

      if (folderPathName && folderPathName.length > 0) {
        mutate(
          `/api/teams/${teamInfo?.currentTeam?.id}/folders/${folderPathName.join("/")}`,
        );
        mutate(
          `/api/teams/${teamInfo?.currentTeam?.id}/folders/documents/${folderPathName.join("/")}`,
        );
      }

      // Reset selection
      setSelectedDocuments([]);
      setSelectedFolders([]);

      toast.success(
        `Successfully hidden ${selectedDocuments.length > 0 ? `${selectedDocuments.length} document${selectedDocuments.length > 1 ? "s" : ""}` : ""}${selectedDocuments.length > 0 && selectedFolders.length > 0 ? " and " : ""}${selectedFolders.length > 0 ? `${selectedFolders.length} folder${selectedFolders.length > 1 ? "s" : ""}` : ""} from All Documents`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to hide items",
      );
    } finally {
      setIsHiding(false);
    }
  }, [selectedDocuments, selectedFolders, teamInfo?.currentTeam?.id, folderPathName]);

  const HeaderContent = memo(() => {
    if (selectedDocumentsLength > 0 || selectedFoldersLength > 0) {
      const totalItems = (documents?.length || 0) + (folders?.length || 0);
      const isAllSelected = totalItems === totalSelectedItem;

      const handleSelectAll = () => {
        if (isAllSelected) {
          setSelectedDocuments([]);
          setSelectedFolders([]);
        } else {
          const allDocumentIds = documents?.map((doc) => doc.id) || [];
          const allFolderIds = folders?.map((folder) => folder.id) || [];
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
          <ButtonTooltip content="Hide from All Documents">
            <Button
              onClick={handleBulkHide}
              disabled={isHiding}
              className="mx-1.5 my-1 size-8 rounded-full hover:bg-gray-200 hover:dark:bg-gray-700"
              variant="ghost"
              size="icon"
            >
              <EyeOffIcon className="h-5 w-5" />
            </Button>
          </ButtonTooltip>
          <ButtonTooltip content="Delete">
            <Button
              onClick={() => setShowDeleteItemsModal(true)}
              className="mx-1.5 my-1 size-8 rounded-full hover:bg-destructive hover:text-destructive-foreground"
              variant="ghost"
              size="icon"
            >
              <Trash2Icon className="h-5 w-5" />
            </Button>
          </ButtonTooltip>
        </div>
      );
    } else {
      return (
        <div className="mb-2 flex items-center gap-x-2 pt-5">
          {folders && folders.length > 0 && (
            <p className="flex items-center gap-x-1 text-sm text-gray-400">
              <FolderIcon className="h-5 w-5" />
              <span>
                {folders.length} folder{folders.length > 1 ? "s" : ""}
              </span>
            </p>
          )}
          {documents && documents.length > 0 && (
            <p className="flex items-center gap-x-1 text-sm text-gray-400">
              <FileIcon className="h-5 w-5" />
              <span>
                {documents.length} document{documents.length > 1 ? "s" : ""}
              </span>
            </p>
          )}
        </div>
      );
    }
  });
  HeaderContent.displayName = "HeaderContent";

  return (
    <>
      <UploadZone
        folderPathName={folderPathName?.join("/")}
        onTraversalStart={onTraversalStart}
        onUploadBatchStart={onUploadBatchStart}
        onUploadBatchUpdate={onUploadBatchUpdate}
        onUploadRejected={onUploadRejected}
        onUploadAborted={onUploadAborted}
        setRejectedFiles={setRejectedFiles}
        cancelledItemIdsRef={cancelledItemIdsRef}
      >
        {isMobile ? (
          <div className="space-y-4">
            {/* Folders list */}
            <ul role="list" className="space-y-4">
              {folders && !foldersLoading
                ? folders.map((folder) => {
                    return (
                      <li key={folder.id}>
                        <FolderCard
                          key={folder.id}
                          folder={folder}
                          teamInfo={teamInfo}
                          isSelected={selectedFolders.includes(folder.id)}
                          isDragging={
                            isDragging && selectedFolders.includes(folder.id)
                          }
                          onDelete={handleDeleteFolder}
                        />
                      </li>
                    );
                  })
                : Array.from({ length: 3 }).map((_, i) => (
                    <li
                      key={i}
                      className="relative flex w-full items-center space-x-3 rounded-lg border px-4 py-5 sm:px-6 lg:px-6"
                    >
                      <Skeleton key={i} className="h-9 w-9" />
                      <div>
                        <Skeleton key={i} className="h-4 w-32" />
                        <Skeleton key={i + 1} className="mt-2 h-3 w-12" />
                      </div>
                      <Skeleton
                        key={i + 1}
                        className="absolute right-5 top-[50%] h-5 w-20 -translate-y-[50%] transform"
                      />
                    </li>
                  ))}
            </ul>

            {/* Documents list */}
            <ul role="list" className="space-y-4">
              {documents && !loading
                ? documents.map((document) => {
                    return (
                      <li key={document.id}>
                        <DocumentCard
                          key={document.id}
                          document={document}
                          teamInfo={teamInfo}
                          isDragging={
                            isDragging &&
                            selectedDocuments.includes(document.id)
                          }
                        />
                      </li>
                    );
                  })
                : Array.from({ length: 3 }).map((_, i) => (
                    <li
                      key={i}
                      className="relative flex w-full items-center space-x-3 rounded-lg border px-4 py-5 sm:px-6 lg:px-6"
                    >
                      <Skeleton key={i} className="h-9 w-9" />
                      <div>
                        <Skeleton key={i} className="h-4 w-32" />
                        <Skeleton key={i + 1} className="mt-2 h-3 w-12" />
                      </div>
                      <Skeleton
                        key={i + 1}
                        className="absolute right-5 top-[50%] h-5 w-20 -translate-y-[50%] transform"
                      />
                    </li>
                  ))}
            </ul>

            <Portal containerId={"documents-header-count"}>
              <HeaderContent />
            </Portal>

            {documents && documents.length === 0 && !loading && (
              <div className="flex items-center justify-center">
                <EmptyDocuments />
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
              <div className="space-y-4">
                {/* Folders list */}
                <ul role="list" className="space-y-4">
                  {folders && !foldersLoading
                    ? folders.map((folder) => {
                        return (
                          <li key={folder.id}>
                            <DroppableFolder
                              key={folder.id}
                              id={folder.id}
                              disabledFolder={selectedFolders}
                              path={folder.path}
                            >
                              <DraggableItem
                                key={folder.id}
                                id={folder.id}
                                isSelected={selectedFolders.includes(folder.id)}
                                onSelect={(id, type) => {
                                  handleSelect(id, type);
                                }}
                                isDraggingSelected={isDragging}
                                type="folder"
                              >
                                <FolderCard
                                  key={folder.id}
                                  folder={folder}
                                  teamInfo={teamInfo}
                                  isSelected={selectedFolders.includes(
                                    folder.id,
                                  )}
                                  isDragging={
                                    isDragging &&
                                    selectedFolders.includes(folder.id)
                                  }
                                  onDelete={handleDeleteFolder}
                                />
                              </DraggableItem>
                            </DroppableFolder>
                          </li>
                        );
                      })
                    : Array.from({ length: 3 }).map((_, i) => (
                        <li
                          key={i}
                          className="relative flex w-full items-center space-x-3 rounded-lg border px-4 py-5 sm:px-6 lg:px-6"
                        >
                          <Skeleton key={i} className="h-9 w-9" />
                          <div>
                            <Skeleton key={i} className="h-4 w-32" />
                            <Skeleton key={i + 1} className="mt-2 h-3 w-12" />
                          </div>
                          <Skeleton
                            key={i + 1}
                            className="absolute right-5 top-[50%] h-5 w-20 -translate-y-[50%] transform"
                          />
                        </li>
                      ))}
                </ul>

                {/* Documents list */}
                <ul role="list" className="space-y-4">
                  {documents && !loading
                    ? documents.map((document) => {
                        return (
                          <li key={document.id}>
                            <DraggableItem
                              key={document.id}
                              id={document.id}
                              isSelected={selectedDocuments.includes(
                                document.id,
                              )}
                              isDraggingSelected={isDragging}
                              type="document"
                              onSelect={(id, type) => {
                                handleSelect(id, type);
                              }}
                            >
                              <DocumentCard
                                key={document.id}
                                document={document}
                                teamInfo={teamInfo}
                                isDragging={
                                  isDragging &&
                                  selectedDocuments.includes(document.id)
                                }
                              />
                            </DraggableItem>
                          </li>
                        );
                      })
                    : Array.from({ length: 3 }).map((_, i) => (
                        <li
                          key={i}
                          className="relative flex w-full items-center space-x-3 rounded-lg border px-4 py-5 sm:px-6 lg:px-6"
                        >
                          <Skeleton key={i} className="h-9 w-9" />
                          <div>
                            <Skeleton key={i} className="h-4 w-32" />
                            <Skeleton key={i + 1} className="mt-2 h-3 w-12" />
                          </div>
                          <Skeleton
                            key={i + 1}
                            className="absolute right-5 top-[50%] h-5 w-20 -translate-y-[50%] transform"
                          />
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
                        <DocumentCard
                          document={draggedDocument}
                          teamInfo={teamInfo}
                        />
                      ) : null}
                      {draggedFolder ? (
                        <FolderCard
                          folder={draggedFolder}
                          teamInfo={teamInfo}
                          onDelete={handleDeleteFolder}
                        />
                      ) : null}
                      {totalSelectedItem > 1 ? (
                        <div className="absolute -right-4 -top-4 rounded-full border border-border bg-foreground px-4 py-2">
                          <span className="text-sm font-semibold text-background">
                            {totalSelectedItem}
                          </span>
                        </div>
                      ) : null}
                    </motion.div>
                  </DragOverlay>
                </Portal>

                <Portal containerId={"documents-header-count"}>
                  <HeaderContent />
                </Portal>

                {documents && documents.length === 0 && !loading && (
                  <div className="flex items-center justify-center">
                    <EmptyDocuments />
                  </div>
                )}
              </div>
            </DndContext>
            {moveFolderOpen ? (
              <MoveToFolderModal
                open={moveFolderOpen}
                setOpen={setMoveFolderOpen}
                setSelectedDocuments={setSelectedDocuments}
                documentIds={selectedDocuments}
                folderIds={selectedFolders}
                folderParentId={parentFolderId}
                setSelectedFoldersId={setSelectedFolders}
              />
            ) : null}
          </>
        )}
      </UploadZone>
      <DeleteFolderModal />
      <DeleteItemsModal />
    </>
  );
}
