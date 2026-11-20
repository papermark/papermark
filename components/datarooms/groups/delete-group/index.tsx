import { Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { useDeleteGroupModal } from "./delete-group-modal";

export default function DeleteGroup({
  dataroomId,
  groupName,
  groupId,
}: {
  dataroomId: string;
  groupName: string;
  groupId: string;
}) {
  const { setShowDeleteGroupModal, DeleteGroupModal } = useDeleteGroupModal({
    dataroomId,
    groupId,
    groupName,
  });

  return (
    <div id="delete-group" className="scroll-mt-24 rounded-lg">
      <DeleteGroupModal />
      <Card className="border-destructive/50 bg-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2Icon className="h-5 w-5 text-destructive" />
            Delete Data Room Group
          </CardTitle>
          <CardDescription>
            Permanently delete{" "}
            <span className="font-medium text-foreground">{groupName}</span>{" "}
            and everything associated with it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">
              This action cannot be undone.
            </p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>- All links in this group will be permanently removed</li>
              <li>- All viewer access via this group will be revoked</li>
              <li>- All views and analytics for those links will be lost</li>
              <li>- Group permissions will be deleted</li>
            </ul>
          </div>
        </CardContent>
        <CardFooter className="flex items-center justify-between rounded-b-lg border-t bg-muted px-6 py-6">
          <p className="text-sm text-muted-foreground">
            You will be asked to type{" "}
            <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">
              confirm delete group
            </code>{" "}
            to continue.
          </p>
          <Button
            onClick={() => setShowDeleteGroupModal(true)}
            variant="destructive"
            className="gap-2"
          >
            <Trash2Icon className="h-4 w-4" />
            Delete Data Room Group
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
