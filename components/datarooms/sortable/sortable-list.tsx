import { useCallback, useState } from "react";

import { TeamContextType } from "@/context/team-context";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CheckIcon } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import {
  DataroomFolderDocument,
  DataroomFolderWithCount,
} from "@/lib/swr/use-dataroom";

import DataroomDocumentCard from "@/components/datarooms/dataroom-document-card";
import { useDeleteFolderModal } from "@/components/documents/actions/delete-folder-modal";
import FolderCard from "@/components/documents/folder-card";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";

import { SortableItem } from "./sortable-item";

type FolderOrDocument =
  | (DataroomFolderWithCount & { itemType: "folder" })
  | (DataroomFolderDocument & { itemType: "document" });

export function DataroomSortableList({
  mixedItems,
  teamInfo,
  dataroomId,
  folderPathName,
  setIsReordering,
}: {
  mixedItems: FolderOrDocument[] | undefined;
  teamInfo: TeamContextType | null;
  dataroomId: string;
  folderPathName?: string[];
  setIsReordering: (isReordering: boolean) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<FolderOrDocument[]>(mixedItems ?? []);

  const { setDeleteModalOpen, setFolderToDelete, DeleteFolderModal } =
    useDeleteFolderModal(teamInfo, true, dataroomId);

  const handleDeleteFolder = useCallback(
    (folderId: string) => {
      const folderToDelete = items.find(
        (f) => f.id === folderId && f.itemType === "folder",
      );
      if (folderToDelete && folderToDelete.itemType === "folder") {
        const { itemType, ...folder } = folderToDelete;
        setFolderToDelete(folder);
        setDeleteModalOpen(true);
        setItems((prevItems) =>
          prevItems.filter((item) => item.id !== folderId),
        );
      }
      setItems((prevItems) => prevItems.filter((item) => item.id !== folderId));
    },
    [items, setFolderToDelete, setDeleteModalOpen, setItems],
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    setActiveId(null);

    if (!over) {
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId !== overId) {
      setItems((prevItems) => {
        const oldIndex = prevItems.findIndex(
          (item) => `${item.itemType}-${item.id}` === activeId,
        );
        const newIndex = prevItems.findIndex(
          (item) => `${item.itemType}-${item.id}` === overId,
        );
        const newOrder = arrayMove(prevItems, oldIndex, newIndex);
        return newOrder;
      });
    }

    setActiveId(null);
  };

  const handleSave = async () => {
    // if nothing changed just return
    if (items.every((item, index) => item.id === mixedItems?.[index].id)) {
      setIsReordering(false);
      return;
    }

    const newOrder = items.map((item, index) => ({
      category: item.itemType,
      id: item.id,
      orderIndex: index,
    }));

    try {
      // Make API call to save the new order
      const response = await fetch(
        `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/reorder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newOrder),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to save new order");
      }

      // Update local data using SWR's mutate
      const baseKey = `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}`;
      mutate(
        `${baseKey}/folders${folderPathName ? `/${folderPathName.join("/")}` : "?root=true"}`,
      );
      mutate(
        `${baseKey}${folderPathName ? `/folder-documents/${folderPathName.join("/")}` : "/documents"}`,
      );
      mutate(`${baseKey}/folders`);
      mutate(`${baseKey}/folders?include_documents=true`);
      setIsReordering(false);
      toast.success("Folder order saved successfully");
    } catch (error) {
      console.error("Failed to save new order:", error);
      toast.error("Failed to save order");
      // Optionally, show an error message to the user
    } finally {
      setIsReordering(false);
    }
  };

  const renderItem = (item: FolderOrDocument) => {
    const itemId = `${item.itemType}-${item.id}`;

    return (
      <SortableItem key={itemId} id={itemId} category={item.itemType}>
        {item.itemType === "folder" ? (
          <FolderCard
            folder={item}
            teamInfo={teamInfo}
            isDataroom
            dataroomId={dataroomId}
            onDelete={handleDeleteFolder}
          />
        ) : (
          <DataroomDocumentCard
            document={item as DataroomFolderDocument}
            teamInfo={teamInfo}
            dataroomId={dataroomId}
          />
        )}
      </SortableItem>
    );
  };

  const activeItem = activeId
    ? items.find((item) => `${item.itemType}-${item.id}` === activeId)
    : null;

  return (
    <div className="rounded-lg border-2 border-dashed border-gray-400 p-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
      >
        <SortableContext
          items={items.map((item) => `${item.itemType}-${item.id}`)}
          strategy={verticalListSortingStrategy}
        >
          <ul role="list" className="relative space-y-4">
            {items.map(renderItem)}
          </ul>
        </SortableContext>
        <DragOverlay>
          {activeItem ? (
            <div
              style={{
                transform: "scale(0.7)",
                opacity: 1,
                pointerEvents: "none",
                boxShadow: "0 0 10px rgba(0, 0, 0, 0.2)",
              }}
            >
              {activeItem.itemType === "folder" ? (
                <FolderCard
                  folder={activeItem}
                  teamInfo={teamInfo}
                  isDataroom
                  dataroomId={dataroomId}
                  onDelete={handleDeleteFolder}
                />
              ) : (
                <DataroomDocumentCard
                  document={activeItem}
                  teamInfo={teamInfo}
                  dataroomId={dataroomId}
                />
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Portal containerId="dataroom-reordering-action">
        <Button
          onClick={handleSave}
          variant={"outline"}
          size="sm"
          className="gap-x-1"
        >
          <CheckIcon className="size-4" />
          Save order
        </Button>
      </Portal>
      <DeleteFolderModal />
    </div>
  );
}
