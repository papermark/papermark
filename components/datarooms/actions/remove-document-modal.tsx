import { useRouter } from "next/router";

import {
  Dispatch,
  SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";

import { useTeam } from "@/context/team-context";
import { toast } from "sonner";
import { mutate } from "swr";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Modal } from "@/components/ui/modal";

import { useAnalytics } from "@/lib/analytics";

function RemoveDataroomItemsModal({
  showRemoveDataroomItemsModal,
  setShowRemoveDataroomItemModal,
  documentIds,
  dataroomId,
  setSelectedDocuments,
  folderIds,
  setSelectedFolders,
}: {
  showRemoveDataroomItemsModal: boolean;
  setShowRemoveDataroomItemModal: Dispatch<SetStateAction<boolean>>;
  documentIds: string[];
  dataroomId: string;
  setSelectedDocuments: Dispatch<SetStateAction<string[]>>;
  folderIds: string[];
  setSelectedFolders: Dispatch<SetStateAction<string[]>>;
}) {
  const router = useRouter();
  const folderPathName = router.query.name as string[] | undefined;
  const teamInfo = useTeam();
  const analytics = useAnalytics();
  const parentFolderPath = folderPathName
    ?.join("/")
    ?.substring(0, folderPathName?.lastIndexOf("/"));

  const [deleting, setDeleting] = useState(false);

  async function deleteDocumentsAndFolders(
    documentIds: string[],
    folderIds: string[],
  ) {
    return new Promise(async (resolve, reject) => {
      setDeleting(true);

      try {
        const deleteDocumentPromises = documentIds.map((documentId) =>
          fetch(
            `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/documents/${documentId}`,
            { method: "DELETE" },
          ).then(async (res) => {
            if (!res.ok) {
              const error = await res.json();
              throw new Error(error.message || "Failed to remove dataroom document");
            }
            analytics.capture("Dataroom Document Removed", {
              team: teamInfo?.currentTeam?.id,
              documentId,
            });
            return documentId; // Return the ID of the successfully removed document
          }),
        );
        const deleteFolderPromises = folderIds.map((folderId) =>
          fetch(
            `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/folders/manage/${folderId}`,
            { method: "DELETE" },
          ).then(async (res) => {
            if (!res.ok) {
              const error = await res.json();
              throw new Error(error.message || "Failed to remove dataroom folder");
            }
            analytics.capture("Dataroom folder Removed", {
              team: teamInfo?.currentTeam?.id,
              folderId,
            });
            return folderId; // Return the ID of the successfully removed folder
          }),
        );

        const results = await Promise.allSettled([
          ...deleteDocumentPromises,
          ...deleteFolderPromises,
        ]);

        const successfullyDeletedItems = results
          .filter((result) => result.status === "fulfilled")
          .map((result) => (result as PromiseFulfilledResult<string>).value);

        const errors = results
          .filter((result) => result.status === "rejected")
          .map((result) => (result as PromiseRejectedResult).reason);

        // Call mutate only once, after all deletions
        await mutate(
          `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}${folderPathName ? `/folder-documents/${folderPathName.join("/")}` : "/documents"}`,
        );
        mutate(
          `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/folders${folderPathName ? `/${folderPathName.join("/")}` : "?root=true"}`,
        );
        mutate(
          `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/folders`,
        );
        setDeleting(false);
        // Deselect only the successfully deleted documents
        setSelectedDocuments((prevSelected) =>
          prevSelected.filter((id) => !successfullyDeletedItems.includes(id)),
        );
        setSelectedFolders((prevSelected) =>
          prevSelected.filter((id) => !successfullyDeletedItems.includes(id)),
        );
        if (errors.length) {
          reject(errors);
        } else {
          resolve(null);
        }
      } catch (error) {
        setDeleting(false);
        reject((error as Error).message);
      } finally {
        setShowRemoveDataroomItemModal(false);
      }
    });
  }

  return (
    <Modal
      showModal={showRemoveDataroomItemsModal}
      setShowModal={setShowRemoveDataroomItemModal}
    >
      <div className="flex flex-col items-center justify-center space-y-3 border-b border-border bg-white px-4 py-4 pt-8 dark:border-gray-900 dark:bg-gray-900 sm:px-8">
        <DialogTitle className="text-2xl">
          Remove {documentIds.length + folderIds.length} item
          {documentIds.length + folderIds.length > 1 && "s"}
        </DialogTitle>
        <DialogDescription className="space-y-2">
          {documentIds.length > 0 && (
            <p>
              <strong>Documents Info</strong>: Existing views will not be
              affected. You can always add removed documents back to the
              dataroom.
            </p>
          )}
          {folderIds.length > 0 && (
            <p>
              <strong>Folders Info</strong>: This will remove the folder and its
              contents from this dataroom. The original documents will remain in
              your workspace.
            </p>
          )}
        </DialogDescription>
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const title = `${documentIds.length > 0 ? `${documentIds.length} document${documentIds.length > 1 ? "s" : ""}` : ""}${
            documentIds.length > 0 && folderIds.length > 0 ? " and " : ""
          }${folderIds.length > 0 ? `${folderIds.length} folder${folderIds.length > 1 ? "s" : ""}` : ""}`;
          toast.promise(deleteDocumentsAndFolders(documentIds, folderIds), {
            loading: `Deleting ${title}...`,
            success: `${title} deleted successfully!`,
            error: (err) => err,
          });
        }}
        className="flex flex-col space-y-6 bg-muted px-4 py-8 text-left dark:bg-gray-900 sm:px-8"
      >
        <Button variant="destructive" loading={deleting}>
          Confirm Remove
          {documentIds.length > 0 &&
            ` ${documentIds.length} document${documentIds.length > 1 ? "s" : ""}`}
          {documentIds.length > 0 && folderIds.length > 0 && " and"}
          {folderIds.length > 0 &&
            ` ${folderIds.length} folder${folderIds.length > 1 ? "s" : ""}`}
        </Button>
      </form>
    </Modal>
  );
}

export function useRemoveDataroomItemsModal({
  documentIds,
  dataroomId,
  setSelectedDocuments,
  folderIds,
  setSelectedFolders,
}: {
  setSelectedFolders: Dispatch<SetStateAction<string[]>>;
  folderIds: string[];
  documentIds: string[];
  dataroomId: string;
  setSelectedDocuments: Dispatch<SetStateAction<string[]>>;
}) {
  const [showRemoveDataroomItemsModal, setShowRemoveDataroomItemModal] =
    useState(false);

  const RemoveDataroomItemModal = useCallback(() => {
    return (
      <RemoveDataroomItemsModal
        showRemoveDataroomItemsModal={showRemoveDataroomItemsModal}
        setShowRemoveDataroomItemModal={setShowRemoveDataroomItemModal}
        documentIds={documentIds}
        dataroomId={dataroomId}
        setSelectedDocuments={setSelectedDocuments}
        folderIds={folderIds}
        setSelectedFolders={setSelectedFolders}
      />
    );
  }, [
    showRemoveDataroomItemsModal,
    setShowRemoveDataroomItemModal,
    documentIds,
    dataroomId,
    setSelectedDocuments,
    folderIds,
    setSelectedFolders,
  ]);

  return useMemo(
    () => ({
      setShowRemoveDataroomItemModal,
      RemoveDataroomItemModal: RemoveDataroomItemModal,
    }),
    [setShowRemoveDataroomItemModal, RemoveDataroomItemModal],
  );
}
