import { memo, useMemo } from "react";

import {
  DataroomFolderWithDocuments,
  useDataroomFoldersTree,
} from "@/lib/swr/use-dataroom";

import { TSelectedFolder } from "@/components/documents/move-folder-modal";
import { FileTree } from "@/components/ui/nextra-filetree";

import { buildNestedFolderStructure } from "./utils";

const FolderComponentSelection = memo(
  ({
    folder,
    selectedFolder,
    setSelectedFolder,
    disableId,
    ancestorDisabled,
  }: {
    folder: DataroomFolderWithDocuments;
    disableId?: string[];
    selectedFolder: TSelectedFolder;
    setSelectedFolder: React.Dispatch<React.SetStateAction<TSelectedFolder>>;
    ancestorDisabled?: boolean;
  }) => {
    const isSelfDisabled = disableId?.includes(folder.id) ?? false;
    const isDisabled = ancestorDisabled || isSelfDisabled;

    const childFolders = useMemo(
      () =>
        folder.childFolders.map((childFolder) => (
          <FolderComponentSelection
            key={childFolder.id}
            folder={childFolder}
            selectedFolder={selectedFolder}
            disableId={disableId}
            setSelectedFolder={setSelectedFolder}
            ancestorDisabled={isDisabled}
          />
        )),
      [
        folder.childFolders,
        selectedFolder,
        setSelectedFolder,
        disableId,
        isDisabled,
      ],
    );

    const isActive = folder.id === selectedFolder?.id;
    const isChildActive = folder.childFolders.some(
      (childFolder) => childFolder.id === selectedFolder?.id,
    );

    return (
      <div
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isDisabled) return;
          path: folder.path,
            setSelectedFolder({
              id: folder.id,
              name: folder.name,
              path: folder.path,
            });
        }}
      >
        <FileTree.Folder
          disable={isDisabled}
          name={folder.name}
          key={folder.id}
          active={isActive}
          childActive={isChildActive}
          onToggle={() => {
            if (isDisabled) return;
            setSelectedFolder({
              id: folder.id,
              name: folder.name,
              path: folder.path,
            });
          }}
        >
          {childFolders}
        </FileTree.Folder>
      </div>
    );
  },
);
FolderComponentSelection.displayName = "FolderComponentSelection";

const SidebarFoldersSelection = ({
  folders,
  selectedFolder,
  setSelectedFolder,
  disableId,
}: {
  folders: DataroomFolderWithDocuments[];
  disableId?: string[];
  selectedFolder: TSelectedFolder;
  setSelectedFolder: React.Dispatch<React.SetStateAction<TSelectedFolder>>;
}) => {
  const nestedFolders = useMemo(() => {
    if (folders) {
      return buildNestedFolderStructure(folders);
    }
    return [];
  }, [folders]);

  // Create a virtual "Home" folder
  const homeFolder: Partial<DataroomFolderWithDocuments> = {
    // @ts-ignore
    id: null,
    name: "Home",
    path: "/",
    childFolders: nestedFolders,
    documents: [],
  };

  return (
    <FileTree>
      {/* {nestedFolders.map((folder) => ( */}
      <FolderComponentSelection
        // key={folder.id}
        // @ts-ignore
        folder={homeFolder}
        selectedFolder={selectedFolder}
        setSelectedFolder={setSelectedFolder}
        disableId={disableId}
      />
      {/* ))} */}
    </FileTree>
  );
};

export function SidebarFolderTreeSelection({
  dataroomId,
  selectedFolder,
  setSelectedFolder,
  disableId,
}: {
  dataroomId: string;
  disableId?: string[];
  selectedFolder: TSelectedFolder;
  setSelectedFolder: React.Dispatch<React.SetStateAction<TSelectedFolder>>;
}) {
  const { folders, error } = useDataroomFoldersTree({ dataroomId });

  if (!folders || error) return null;

  return (
    <SidebarFoldersSelection
      folders={folders}
      selectedFolder={selectedFolder}
      setSelectedFolder={setSelectedFolder}
      disableId={disableId}
    />
  );
}
