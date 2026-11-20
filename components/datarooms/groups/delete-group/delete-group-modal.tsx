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
import { CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

import { useAnalytics } from "@/lib/analytics";

function DeleteGroupModal({
  dataroomId,
  groupName,
  groupId,
  showDeleteGroupModal,
  setShowDeleteGroupModal,
}: {
  dataroomId: string;
  groupName: string;
  groupId: string;
  showDeleteGroupModal: boolean;
  setShowDeleteGroupModal: Dispatch<SetStateAction<boolean>>;
}) {
  const router = useRouter();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const analytics = useAnalytics();

  const [deleting, setDeleting] = useState(false);

  async function deleteGroup() {
    return new Promise((resolve, reject) => {
      setDeleting(true);

      fetch(`/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}`, {
        method: "DELETE",
      }).then(async (res) => {
        if (res.ok) {
          analytics.capture("Group Deleted", {
            dataroomId: dataroomId,
            groupName: groupName,
            groupId: groupId,
          });
          await mutate(`/api/teams/${teamId}/datarooms/${dataroomId}/groups`);
          router.push(`/datarooms/${dataroomId}/groups`);
          resolve(null);
        } else {
          setDeleting(false);
          const error = await res.json();
          reject(error.message);
        }
      });
    });
  }

  return (
    <Modal
      showModal={showDeleteGroupModal}
      setShowModal={setShowDeleteGroupModal}
    >
      <div className="flex flex-col items-center justify-center space-y-3 border-b border-border bg-white px-4 py-4 pt-8 dark:border-gray-900 dark:bg-gray-900 sm:px-8">
        <CardTitle>Delete Data Room Group</CardTitle>
        <CardDescription className="text-md font-semibold text-foreground">
          {groupName}
        </CardDescription>
        <CardDescription>
          Warning: This will permanently delete your dataroom group, all
          associated links and their respective views.
        </CardDescription>
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          toast.promise(deleteGroup(), {
            loading: "Deleting group...",
            success: "Group deleted successfully!",
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
            To verify, type{" "}
            <span className="font-semibold text-foreground">
              confirm delete group
            </span>{" "}
            below
          </label>
          <div className="relative mt-1 rounded-md shadow-sm">
            <Input
              type="text"
              name="verification"
              id="verification"
              pattern="confirm delete group"
              required
              autoComplete="off"
              className="bg-white dark:border-gray-500 dark:bg-gray-800 focus:dark:bg-transparent"
            />
          </div>
        </div>

        <Button variant="destructive" loading={deleting}>
          Confirm delete group
        </Button>
      </form>
    </Modal>
  );
}

export function useDeleteGroupModal({
  dataroomId,
  groupId,
  groupName,
}: {
  dataroomId: string;
  groupId: string;
  groupName: string;
}) {
  const [showDeleteGroupModal, setShowDeleteGroupModal] = useState(false);

  const DeleteGroupModalCallback = useCallback(() => {
    return (
      <DeleteGroupModal
        dataroomId={dataroomId}
        groupId={groupId}
        groupName={groupName}
        showDeleteGroupModal={showDeleteGroupModal}
        setShowDeleteGroupModal={setShowDeleteGroupModal}
      />
    );
  }, [showDeleteGroupModal, setShowDeleteGroupModal]);

  return useMemo(
    () => ({
      setShowDeleteGroupModal,
      DeleteGroupModal: DeleteGroupModalCallback,
    }),
    [setShowDeleteGroupModal, DeleteGroupModalCallback],
  );
}
