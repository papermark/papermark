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

import { useDeleteDataroomModal } from "./delete-dataroom-modal";

export default function DeleteDataroom({
  dataroomId,
  dataroomName,
}: {
  dataroomId: string;
  dataroomName: string;
}) {
  const { setShowDeleteDataroomModal, DeleteDataroomModal } =
    useDeleteDataroomModal({ dataroomId, dataroomName });

  return (
    <div className="rounded-lg">
      <DeleteDataroomModal />
      <Card className="border-destructive/50 bg-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2Icon className="h-5 w-5 text-destructive" />
            Delete Data Room
          </CardTitle>
          <CardDescription>
            Permanently delete{" "}
            <span className="font-medium text-foreground">{dataroomName}</span>{" "}
            and everything associated with it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">
              This action cannot be undone.
            </p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>- All documents and folders will be permanently removed</li>
              <li>- All links and viewer access will be revoked</li>
              <li>- All analytics, audit logs, and Q&A data will be lost</li>
              <li>- Group permissions and branding will be deleted</li>
            </ul>
          </div>
        </CardContent>
        <CardFooter className="flex items-center justify-between rounded-b-lg border-t bg-muted px-6 py-6">
          <p className="text-sm text-muted-foreground">
            You will be asked to type{" "}
            <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">
              confirm delete dataroom
            </code>{" "}
            to continue.
          </p>
          <Button
            onClick={() => setShowDeleteDataroomModal(true)}
            variant="destructive"
            className="gap-2"
          >
            <Trash2Icon className="h-4 w-4" />
            Delete Data Room
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
