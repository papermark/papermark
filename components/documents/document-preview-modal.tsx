import { useEffect } from "react";

import { XIcon } from "lucide-react";
import { toast } from "sonner";

import { useDocumentPreview } from "@/lib/swr/use-document-preview";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import LoadingSpinner from "@/components/ui/loading-spinner";

import { PreviewViewer } from "./preview-viewers/preview-viewer";

interface DocumentPreviewModalProps {
  documentId: string;
  isOpen: boolean;
  onClose: () => void;
  initialPage?: number;
}

export function DocumentPreviewModal({
  documentId,
  isOpen,
  onClose,
  initialPage,
}: DocumentPreviewModalProps) {
  const {
    document: documentData,
    loading,
    error,
  } = useDocumentPreview(documentId, isOpen);

  const handleClose = () => {
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleClose();
    }
  };

  const handleContentClick = (e: React.MouseEvent) => {
    // Prevent clicks from propagating to underlying elements
    e.stopPropagation();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent
        className="h-[99vh] w-[90%] rounded-lg bg-gray-900 p-0 data-[state=open]:slide-in-from-bottom-0 md:w-[80vw] md:max-w-[80vw]"
        onKeyDown={handleKeyDown}
        onClick={handleContentClick}
        isPreviewDialog
      >
        {/* Header with close button */}
        <div className="absolute right-4 top-4 z-50">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="h-8 w-8 rounded-full bg-black/20 text-white hover:bg-black/40"
          >
            <XIcon className="h-4 w-4" />
          </Button>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex h-full w-full items-center justify-center">
            <div className="text-center">
              <LoadingSpinner className="mx-auto h-8 w-8 text-white" />
              <p className="mt-2 text-sm text-gray-400">Loading preview...</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex h-full w-full items-center justify-center">
            <div className="text-center">
              <p className="text-red-400">
                {(error as Error).message || "Failed to load document preview"}
              </p>
            </div>
          </div>
        )}

        {/* Document preview */}
        {documentData && !loading && !error && (
          <PreviewViewer
            documentData={documentData}
            onClose={handleClose}
            initialPage={initialPage}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
