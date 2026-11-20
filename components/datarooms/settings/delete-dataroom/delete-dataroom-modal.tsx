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

function DeleteDataroomModal({
  dataroomId,
  dataroomName,
  showDeleteDataroomModal,
  setShowDeleteDataroomModal,
}: {
  dataroomId: string;
  dataroomName: string;
  showDeleteDataroomModal: boolean;
  setShowDeleteDataroomModal: Dispatch<SetStateAction<boolean>>;
}) {
  const router = useRouter();
  const teamInfo = useTeam();
  const analytics = useAnalytics();

  const [deleting, setDeleting] = useState(false);

  async function deleteDataroom() {
    return new Promise((resolve, reject) => {
      setDeleting(true);

      fetch(`/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      }).then(async (res) => {
        if (res.ok) {
          analytics.capture("Dataroom Deleted", {
            dataroomName: dataroomName,
            dataroomId: dataroomId,
          });
          await Promise.all([
            mutate(`/api/teams/${teamInfo?.currentTeam?.id}/datarooms`),
            mutate(`/api/teams/${teamInfo?.currentTeam?.id}/datarooms?simple=true`),
          ]);
          router.push("/datarooms");
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
      showModal={showDeleteDataroomModal}
      setShowModal={setShowDeleteDataroomModal}
    >
      <div className="flex flex-col items-center justify-center space-y-3 border-b border-border bg-white px-4 py-4 pt-8 dark:border-gray-900 dark:bg-gray-900 sm:px-8">
        <CardTitle>Delete Dataroom</CardTitle>
        <CardDescription className="text-md font-semibold text-foreground">
          {dataroomName}
        </CardDescription>
        <CardDescription>
          Warning: This will permanently delete your dataroom and all associated
          links and their respective views.
        </CardDescription>
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          toast.promise(deleteDataroom(), {
            loading: "Deleting dataroom...",
            success: "Dataroom deleted successfully!",
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
              confirm delete dataroom
            </span>{" "}
            below
          </label>
          <div className="relative mt-1 rounded-md shadow-sm">
            <Input
              type="text"
              name="verification"
              id="verification"
              pattern="confirm delete dataroom"
              required
              autoComplete="off"
              className="bg-white dark:border-gray-500 dark:bg-gray-800 focus:dark:bg-transparent"
            />
          </div>
        </div>

        <Button variant="destructive" loading={deleting}>
          Confirm delete dataroom
        </Button>
      </form>
    </Modal>
  );
}

export function useDeleteDataroomModal({
  dataroomId,
  dataroomName,
}: {
  dataroomId: string;
  dataroomName: string;
}) {
  const [showDeleteDataroomModal, setShowDeleteDataroomModal] = useState(false);

  const DeleteDataroomModalCallback = useCallback(() => {
    return (
      <DeleteDataroomModal
        dataroomId={dataroomId}
        dataroomName={dataroomName}
        showDeleteDataroomModal={showDeleteDataroomModal}
        setShowDeleteDataroomModal={setShowDeleteDataroomModal}
      />
    );
  }, [showDeleteDataroomModal, setShowDeleteDataroomModal]);

  return useMemo(
    () => ({
      setShowDeleteDataroomModal,
      DeleteDataroomModal: DeleteDataroomModalCallback,
    }),
    [setShowDeleteDataroomModal, DeleteDataroomModalCallback],
  );
}
