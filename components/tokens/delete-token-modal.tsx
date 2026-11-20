import {
  Dispatch,
  SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";

import { useTeam } from "@/context/team-context";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DeleteTokenModalProps {
  showModal: boolean;
  setShowModal: Dispatch<SetStateAction<boolean>>;
  token: { id: string; name: string };
  onDeleted?: () => void;
}

function DeleteTokenModal({
  showModal,
  setShowModal,
  token,
  onDeleted,
}: DeleteTokenModalProps) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const expected = token.name;
  const canDelete = confirm.trim() === expected && !isLoading && !!teamId;

  const handleDelete = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canDelete) return;
    if (!teamId) {
      toast.error("No team selected. Please try again.");
      return;
    }
    try {
      setIsLoading(true);
      const response = await fetch(`/api/teams/${teamId}/tokens`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId: token.id }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error);
      }
      toast.success("API key revoked");
      setShowModal(false);
      onDeleted?.();
    } catch (error) {
      console.error(error);
      toast.error((error as Error).message || "Failed to revoke API key");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      open={showModal}
      onOpenChange={(open) => {
        setShowModal(open);
        if (!open) setConfirm("");
      }}
    >
      <DialogContent className="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Revoke API key</DialogTitle>
          <DialogDescription>
            This action cannot be undone. Any apps or scripts using this key
            will immediately lose access.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleDelete} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="confirm-name">
              Type{" "}
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {expected}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-name"
              autoFocus
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="bg-white text-gray-900 dark:bg-white"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!canDelete}
              loading={isLoading}
            >
              Revoke key
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function useDeleteTokenModal({
  token,
  onDeleted,
}: {
  token: { id: string; name: string } | null;
  onDeleted?: () => void;
}) {
  const [showDeleteTokenModal, setShowDeleteTokenModal] = useState(false);

  const DeleteTokenModalCallback = useCallback(() => {
    if (!token) return null;
    return (
      <DeleteTokenModal
        showModal={showDeleteTokenModal}
        setShowModal={setShowDeleteTokenModal}
        token={token}
        onDeleted={onDeleted}
      />
    );
  }, [showDeleteTokenModal, token, onDeleted]);

  return useMemo(
    () => ({
      showDeleteTokenModal,
      setShowDeleteTokenModal,
      DeleteTokenModal: DeleteTokenModalCallback,
    }),
    [showDeleteTokenModal, DeleteTokenModalCallback],
  );
}
