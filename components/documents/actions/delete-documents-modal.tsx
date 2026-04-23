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

import { useAnalytics } from "@/lib/analytics";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

function DeleteItemsModal({
  showDeleteItemsModal,
  setShowDeleteItemsModal,
  documentIds,
  setSelectedDocuments,
  folderIds,
  setSelectedFolder,
}: {
  showDeleteItemsModal: boolean;
  setShowDeleteItemsModal: Dispatch<SetStateAction<boolean>>;
  documentIds: string[];
  setSelectedDocuments: Dispatch<SetStateAction<string[]>>;
  folderIds: string[];
  setSelectedFolder: Dispatch<SetStateAction<string[]>>;
}) {
  const router = useRouter();
  const folderPathName = router.query.name as string[] | undefined;
  const teamInfo = useTeam();
  const analytics = useAnalytics();

  const [deleting, setDeleting] = useState(false);
  const [isValid, setIsValid] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    // Check if the input matches the pattern
    if (value === "permanently delete") {
      setIsValid(true);
    } else {
      setIsValid(false);
    }
  };

  async function deleteDocumentsAndFolders(
    documentIds: string[],
    folderIds: string[],
  ) {
    return new Promise(async (resolve, reject) => {
      setDeleting(true);

      try {
        const deleteDocumentPromises = documentIds.map((documentId) =>
          fetch(
            `/api/teams/${teamInfo?.currentTeam?.id}/documents/${documentId}`,
            {
              method: "DELETE",
              headers: {
                "Content-Type": "application/json",
              },
            },
          ).then(async (res) => {
            if (!res.ok) {
              const error = await res.json();
              throw new Error(error.message || "Failed to delete document");
            }
            analytics.capture("Document Deleted", {
              team: teamInfo?.currentTeam?.id,
              documentId,
            });
            return documentId;
          }),
        );

        const deleteFolderPromises = folderIds.map((folderId) =>
          fetch(
            `/api/teams/${teamInfo?.currentTeam?.id}/folders/manage/${folderId}`,
            {
              method: "DELETE",
            },
          ).then(async (res) => {
            if (!res.ok) {
              const error = await res.json();
              throw new Error(error.message || "Failed to delete folder");
            }
            analytics.capture("Folder Deleted", {
              team: teamInfo?.currentTeam?.id,
              folderId,
            });
            return folderId;
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
        if (!errors.length) {
          setShowDeleteItemsModal(false);
        }
        setSelectedDocuments((prevSelected) =>
          prevSelected.filter((id) => !successfullyDeletedItems.includes(id)),
        );

        setSelectedFolder((prevSelected) =>
          prevSelected.filter((id) => !successfullyDeletedItems.includes(id)),
        );

        await mutate(
          `/api/teams/${teamInfo?.currentTeam?.id}/folders?root=true`,
        );
        await mutate(`/api/teams/${teamInfo?.currentTeam?.id}/folders`);
        if (folderPathName && folderPathName.length > 0) {
          await mutate(
            `/api/teams/${
              teamInfo?.currentTeam?.id
            }/folders/${folderPathName.join("/")}`,
          );
          await mutate(
            `/api/teams/${
              teamInfo?.currentTeam?.id
            }/folders/documents/${folderPathName.join("/")}`,
          );
        } else {
          const { search, sort, page, limit } = router.query;
          const queryParts = [];
          if (search) queryParts.push(`query=${search}`);
          if (sort) queryParts.push(`sort=${sort}`);

          const pageNum = Number(page) || 1;
          const limitNum = Number(limit) || 10;

          const paginationParams =
            search || sort ? `&page=${pageNum}&limit=${limitNum}` : "";

          if (paginationParams) queryParts.push(paginationParams.substring(1));
          const queryString =
            queryParts.length > 0 ? `?${queryParts.join("&")}` : "";

          await mutate(
            `/api/teams/${teamInfo?.currentTeam?.id}/documents${queryString}`,
          );
        }

        setDeleting(false);

        if (errors.length) {
          reject(errors);
        } else {
          resolve(null);
        }
      } catch (error) {
        setDeleting(false);
        reject((error as Error).message);
      } finally {
        setShowDeleteItemsModal(false);
      }
    });
  }

  return (
    <Modal
      showModal={showDeleteItemsModal}
      setShowModal={setShowDeleteItemsModal}
      noBackdropBlur
    >
      <div className="flex flex-col items-center justify-center space-y-3 border-b border-border bg-white px-4 py-4 pt-8 dark:border-gray-900 dark:bg-gray-900 sm:px-8">
        <DialogTitle className="text-2xl">
          Delete{" "}
          {documentIds.length > 0 && (
            <>
              {documentIds.length} Document{documentIds.length > 1 && "s"}
            </>
          )}
          {documentIds.length > 0 && folderIds.length > 0 && " and "}
          {folderIds.length > 0 && (
            <>
              {folderIds.length} Folder{folderIds.length > 1 && "s"}
            </>
          )}
        </DialogTitle>
        <DialogDescription className="space-y-2">
          {documentIds.length > 0 && (
            <p>
              <strong>Documents Warning</strong>: This will permanently delete
              your selected documents, all associated links and their respective
              views.  {" "}
            </p>
          )}
          {folderIds.length > 0 && (
            <p>
              <strong>Folders Warning</strong>: This will permanently delete the
              folder and all its contents, including subfolders, documents,
              dataroom references, and any visitor analytics.
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
        <div>
          <label
            htmlFor="verification"
            className="block text-sm text-muted-foreground"
          >
            To confirm deletion, type{" "}
            <span className="font-semibold text-foreground">
              permanently delete
            </span>{" "}
            below
          </label>
          <div className="relative mt-1 rounded-md shadow-sm">
            <Input
              type="text"
              name="verification"
              id="verification"
              pattern="permanently delete"
              required
              autoComplete="off"
              className="bg-white dark:border-gray-500 dark:bg-gray-800 focus:dark:bg-transparent"
              onInput={handleInputChange}
            />
          </div>
        </div>

        <Button
          variant="destructive"
          type="submit"
          loading={deleting}
          disabled={!isValid}
        >
          Confirm delete
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

export function useDeleteDocumentsAndFoldersModal({
  documentIds,
  setSelectedDocuments,
  folderIds,
  setSelectedFolder,
}: {
  setSelectedFolder: Dispatch<SetStateAction<string[]>>;
  folderIds: string[];
  documentIds: string[];
  setSelectedDocuments: Dispatch<SetStateAction<string[]>>;
}) {
  const [showDeleteItemsModal, setShowDeleteItemsModal] = useState(false);

  const DeleteItemsModalCallback = useCallback(() => {
    return (
      <DeleteItemsModal
        showDeleteItemsModal={showDeleteItemsModal}
        setShowDeleteItemsModal={setShowDeleteItemsModal}
        documentIds={documentIds}
        setSelectedDocuments={setSelectedDocuments}
        folderIds={folderIds}
        setSelectedFolder={setSelectedFolder}
      />
    );
  }, [
    showDeleteItemsModal,
    setShowDeleteItemsModal,
    documentIds,
    setSelectedDocuments,
    folderIds,
    setSelectedFolder,
  ]);

  return useMemo(
    () => ({
      setShowDeleteItemsModal,
      DeleteItemsModal: DeleteItemsModalCallback,
    }),
    [setShowDeleteItemsModal, DeleteItemsModalCallback],
  );
}
