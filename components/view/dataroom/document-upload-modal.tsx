import { useEffect, useMemo, useState } from "react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ViewerUploadComponent } from "@/components/viewer-upload-component";

type AllowedFolder = {
  id: string;
  name: string;
  path?: string | null;
};

/**
 * "Upload Document" entry-point for dataroom visitors.
 *
 * Destination selection rules:
 *   - If the admin restricted uploads to a single folder, that folder is shown
 *     read-only.
 *   - If the admin restricted uploads to multiple folders, the visitor picks
 *     one via a select. If the folder they're currently browsing is on the
 *     allow-list, it is pre-selected.
 *   - If the admin didn't restrict uploads, we fall back to the folder the
 *     visitor is currently in (original behaviour).
 */
export function DocumentUploadModal({
  linkId,
  dataroomId,
  viewerId,
  folderId,
  folderName,
  allowedFolders,
}: {
  linkId: string;
  dataroomId: string;
  viewerId: string;
  /** Folder the viewer is currently browsing (undefined = root/home). */
  folderId?: string;
  /** Display name of the current folder (undefined = root). */
  folderName?: string;
  /**
   * Restricted allow-list of folders this link may upload into. `null` or
   * `undefined` means "no restriction".
   */
  allowedFolders?: AllowedFolder[] | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const hasRestriction = !!allowedFolders && allowedFolders.length > 0;

  // Decide the default destination.
  // When restricted, prefer the current folder if it's allowed, otherwise the
  // first folder in the admin-defined allow-list. Without a restriction, we
  // default to the folder the viewer is currently in.
  const defaultDestination = useMemo<string | undefined>(() => {
    if (hasRestriction) {
      if (folderId && allowedFolders!.some((f) => f.id === folderId)) {
        return folderId;
      }
      return allowedFolders![0]?.id;
    }
    return folderId;
  }, [hasRestriction, allowedFolders, folderId]);

  const [destinationId, setDestinationId] = useState<string | undefined>(
    defaultDestination,
  );

  // Keep the picker in sync when the viewer navigates between folders while
  // the modal is closed.
  useEffect(() => {
    setDestinationId(defaultDestination);
  }, [defaultDestination]);

  const destinationName = useMemo(() => {
    if (hasRestriction) {
      return allowedFolders!.find((f) => f.id === destinationId)?.name;
    }
    return folderName;
  }, [hasRestriction, allowedFolders, destinationId, folderName]);

  const handleUploadSuccess = () => {
    setUploadSuccess(true);
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

  const showSelect = hasRestriction && allowedFolders!.length > 1;
  const showReadOnlyRestriction = hasRestriction && allowedFolders!.length === 1;

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

            {showSelect ? (
              <div className="mt-3 space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <FolderIcon className="h-3.5 w-3.5" />
                  Destination folder
                </label>
                <Select
                  value={destinationId}
                  onValueChange={(value) => setDestinationId(value)}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder="Select destination folder" />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedFolders!.map((folder) => (
                      <SelectItem key={folder.id} value={folder.id}>
                        <span className="flex items-center gap-2">
                          <FolderIcon className="h-3.5 w-3.5" />
                          <span className="max-w-[320px] truncate">
                            {folder.name}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : destinationName ? (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <FolderIcon className="h-3.5 w-3.5" />
                <span>
                  Uploading to:{" "}
                  <span className="font-medium text-foreground">
                    {destinationName}
                  </span>
                  {showReadOnlyRestriction ? (
                    <span className="ml-1 text-muted-foreground">
                      (set by the dataroom owner)
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}
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
                folderId={destinationId}
                onUploadSuccess={handleUploadSuccess}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
