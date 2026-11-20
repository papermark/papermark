import { toast } from "sonner";
import { mutate } from "swr";

export const moveDataroomFolderToFolder = async ({
  folderIds,
  selectedFolder,
  folderPathName,
  dataroomId,
  teamId,
  selectedFolderPath,
}: {
  folderIds: string[];
  selectedFolder: string;
  folderPathName: string[] | undefined;
  teamId?: string;
  dataroomId: string;
  selectedFolderPath: string;
}) => {
  if (!teamId) {
    toast.error("Team is required to move documents");
    return;
  }
  const key = `/api/teams/${teamId}/datarooms/${dataroomId}${folderPathName ? `/folders/${folderPathName.join("/")}` : "/folders?root=true"}`;
  // Optimistically update the UI by removing the folder from current folders
  mutate(
    key,
    (folder: any) => {
      if (!folder) return folder;

      // Filter out the folder that are being moved
      const updatedFolder = folder.filter(
        (doc: any) => !folderIds.includes(doc.id),
      );
      // Return the updated list of folder
      return updatedFolder;
    },
    false,
  );

  try {
    // Make the API call to move the document
    const response = await fetch(
      `/api/teams/${teamId}/datarooms/${dataroomId}/folders/move`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedFolder,
          folderIds,
          selectedFolderPath,
        }),
      },
    );

    if (!response.ok) {
      const { message } = await response.json();
      throw new Error(message);
      return;
    }

    const { updatedCount, newPath } = await response.json();

    // Update local data using SWR's mutate
    mutate(key);
    mutate(
      `/api/teams/${teamId}/datarooms/${dataroomId}/folders${newPath ? `${newPath}` : "?root=true"}`,
    );
    mutate(`/api/teams/${teamId}/datarooms/${dataroomId}/folders`);
    // update documents in new folder (`newPath` or home)
    mutate(
      `/api/teams/${teamId}/datarooms/${dataroomId}${newPath ? `/folder-documents/${newPath}` : "/documents"}`,
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
