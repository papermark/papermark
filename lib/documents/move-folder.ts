import { toast } from "sonner";
import { mutate } from "swr";

export const moveFolderToFolder = async ({
  folderIds,
  folderPathName,
  teamId,
  selectedFolder,
  selectedFolderPath,
}: {
  folderIds: string[];
  folderPathName?: string[];
  teamId?: string;
  selectedFolder?: string;
  selectedFolderPath: string;
}) => {
  if (!teamId) {
    toast.error("Team is required to move documents");
    return;
  }
  const key = `/api/teams/${teamId}${folderPathName ? `/folders/${folderPathName.join("/")}` : "/folders?root=true"}`;
  mutate(
    key,
    (folder: any) => {
      if (!folder) return folder;
      // Filter out the folder that are being moved
      interface Folder {
        id: string;
      }

      const updatedFolder: Folder[] = folder.filter(
        (f: Folder) => !folderIds.includes(f.id),
      );
      // Return the updated list of folder
      return updatedFolder;
    },
    false,
  );

  try {
    // Make the API call to move the document
    const response = await fetch(`/api/teams/${teamId}/folders/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selectedFolder,
        folderIds,
        selectedFolderPath,
      }),
    });

    if (!response.ok) {
      const { message } = await response.json();
      throw new Error(message);
      return;
    }

    const { updatedCount, newPath } = await response.json();
    mutate(key);
    mutate(
      `/api/teams/${teamId}/folders${newPath ? `${newPath}` : "?root=true"}`,
    );
    mutate(
      `/api/teams/${teamId}${newPath ? `/folder-documents/${newPath}` : "/documents"}`,
    );
    toast.success(
      `${updatedCount} folder${updatedCount > 1 ? "s" : ""} moved successfully`,
    );
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to move documents",
    );
    // Revert the UI back to the previous state
    mutate(key);
  }
};
