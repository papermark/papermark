import { DataroomDocument, DataroomFolder } from "@prisma/client";

import { DataroomFolderWithDocuments } from "@/lib/swr/use-dataroom";

// Helper function to build nested folder structure
export const buildNestedFolderStructure = (
  folders: DataroomFolderWithDocuments[],
) => {
  const folderMap = new Map();

  // Initialize every folder with an additional childFolders property
  folders.forEach((folder) => {
    folderMap.set(folder.id, { ...folder, childFolders: [] });
  });

  const rootFolders: DataroomFolderWithDocuments[] = [];

  folderMap.forEach((folder, id) => {
    if (folder.parentId) {
      const parent = folderMap.get(folder.parentId);
      parent.childFolders.push(folder);
    } else {
      rootFolders.push(folder);
    }
  });

  return rootFolders;
};

export const buildNestedFolderStructureWithDocs = (
  folders: DataroomFolder[],
  documents: DataroomDocumentWithVersion[],
) => {
  const folderMap = new Map();

  // Initialize every folder with an additional childFolders property
  folders.forEach((folder) => {
    folderMap.set(folder.id, {
      ...folder,
      documents: documents.filter((doc) => doc.folderId === folder.id),
      childFolders: [],
    });
  });

  const rootFolders: DataroomFolderWithDocumentsNew[] = [];

  folderMap.forEach((folder, id) => {
    if (folder.parentId) {
      const parent = folderMap.get(folder.parentId);
      parent.childFolders.push(folder);
    } else {
      rootFolders.push(folder);
    }
  });

  return rootFolders;
};

type DataroomDocumentWithVersion = {
  dataroomDocumentId: string;
  folderId: string | null;
  id: string;
  name: string;
  orderIndex: number | null;
  hierarchicalIndex: string | null;
  versions: {
    id: string;
    versionNumber: number;
    hasPages: boolean;
  }[];
};

type DataroomFolderWithDocumentsNew = DataroomFolder & {
  childFolders: DataroomFolderWithDocumentsNew[];
  documents: {
    dataroomDocumentId: string;
    folderId: string | null;
    id: string;
    name: string;
    orderIndex: number | null;
    hierarchicalIndex: string | null;
  }[];
};

export const itemsMessage = (
  documentsToMove: string[],
  foldersToMove: string[],
  action: "Moving" | "Successfully moved",
) => {
  const docCount = documentsToMove.length;
  const folderCount = foldersToMove.length;

  if (docCount && folderCount) {
    return `${action} ${docCount} document${docCount > 1 ? "s" : ""} and ${folderCount} folder${folderCount > 1 ? "s" : ""}...`;
  }
  if (docCount) {
    return `${action} ${docCount} document${docCount > 1 ? "s" : ""}...`;
  }
  if (folderCount) {
    return `${action} ${folderCount} folder${folderCount > 1 ? "s" : ""}...`;
  }
  return `${action} items...`;
};
