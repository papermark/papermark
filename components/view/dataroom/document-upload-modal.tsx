import { useState } from "react";

import {
  CheckCircle2,
  FolderIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ViewerUploadComponent } from "@/components/viewer-upload-component";

export function DocumentUploadModal({
  linkId,
  dataroomId,
  viewerId,
  folderId,
  folderName,
}: {
  linkId: string;
  dataroomId: string;
  viewerId: string;
  folderId?: string;
  /** Display name of the current folder (undefined = root) */
  folderName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const handleUploadSuccess = () => {
    setUploadSuccess(true);
    // Auto-close the dialog after a short delay to show success message
    setTimeout(() => {
      setIsOpen(false);
      setUploadSuccess(false);
    }, 1500);
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setUploadSuccess(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        size="sm"
        variant="outline"
        className="group flex items-center justify-start gap-x-3 px-3 text-left"
        title="Add Document"
      >
        <PlusIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>Add Document</span>
      </Button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden border-0 p-0 shadow-2xl sm:max-w-xl sm:rounded-2xl">
          <DialogHeader className="border-b border-gray-100 bg-gray-50 px-6 py-5 dark:border-gray-800 dark:bg-gray-900">
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              <UploadIcon className="h-5 w-5 text-muted-foreground" />
              Upload Document to Dataroom
            </DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Your document will appear immediately in the dataroom and will be
              processed in the background.
            </p>
            {folderName && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <FolderIcon className="h-3.5 w-3.5" />
                <span>
                  Uploading to:{" "}
                  <span className="font-medium text-foreground">
                    {folderName}
                  </span>
                </span>
              </div>
            )}
          </DialogHeader>

          <div className="min-w-0 px-6 py-5">
            {uploadSuccess ? (
              <div className="flex flex-col items-center justify-center py-8">
                <CheckCircle2 className="h-12 w-12 text-green-500" />
                <p className="mt-3 text-sm font-medium text-foreground">
                  Document uploaded successfully!
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your document is now visible in the dataroom.
                </p>
              </div>
            ) : (
              <ViewerUploadComponent
                viewerData={{
                  id: viewerId,
                  linkId,
                  dataroomId,
                }}
                teamId="visitor-upload"
                folderId={folderId}
                onUploadSuccess={handleUploadSuccess}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
