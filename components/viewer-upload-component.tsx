import { useRef, useState } from "react";

import { FileUp } from "lucide-react";
import { toast } from "sonner";

import { usePendingUploads } from "@/context/pending-uploads-context";
import { DocumentData } from "@/lib/documents/create-document";
import { newId } from "@/lib/id-helper";
import { cn } from "@/lib/utils";

import { Progress } from "@/components/ui/progress";
import ViewerUploadZone from "@/components/viewer-upload-zone";

export function ViewerUploadComponent({
  viewerData,
  teamId,
  folderId,
  onUploadSuccess,
}: {
  viewerData: { id: string; linkId: string; dataroomId?: string };
  teamId: string;
  folderId?: string;
  onUploadSuccess?: () => void;
}) {
  const [uploads, setUploads] = useState<
    { uploadId: string; fileName: string; progress: number }[]
  >([]);
  const [rejectedFiles, setRejectedFiles] = useState<
    { fileName: string; message: string }[]
  >([]);

  const { addPendingUpload, updatePendingUpload } = usePendingUploads();

  // Map each active upload item to its pending upload record
  const pendingUploadIds = useRef<Map<string, string>>(new Map());
  const activeUploadIds = useRef<Set<string>>(new Set());
  const failedCountRef = useRef(0);

  const finalizeSessionIfIdle = () => {
    if (activeUploadIds.current.size > 0) return;
    const hasFailures = failedCountRef.current > 0;
    failedCountRef.current = 0;

    if (!hasFailures) {
      onUploadSuccess?.();
    }
  };

  const handleUploadStart = (
    newUploads: { uploadId: string; fileName: string; progress: number }[],
  ) => {
    const isStartingFreshSession = activeUploadIds.current.size === 0;
    if (isStartingFreshSession) {
      failedCountRef.current = 0;
      setRejectedFiles([]);
    }
    setUploads((prev) => [...prev, ...newUploads]);

    newUploads.forEach((upload) => {
      activeUploadIds.current.add(upload.uploadId);
      const pendingId = newId("pending");
      pendingUploadIds.current.set(upload.uploadId, pendingId);

      addPendingUpload({
        id: pendingId,
        name: upload.fileName,
        folderId: folderId ?? null,
        uploadedAt: new Date(),
        status: "uploading",
        progress: 0,
      });
    });
  };

  const handleUploadProgress = (uploadId: string, progress: number) => {
    setUploads((prev) => {
      const updated = prev.map((upload) =>
        upload.uploadId === uploadId ? { ...upload, progress } : upload,
      );

      const pendingId = pendingUploadIds.current.get(uploadId);
      if (pendingId) {
        updatePendingUpload(pendingId, { progress });
      }

      return updated;
    });
  };

  const settleUpload = (uploadId: string, failed: boolean) => {
    if (failed) {
      failedCountRef.current += 1;
    }

    activeUploadIds.current.delete(uploadId);
    pendingUploadIds.current.delete(uploadId);
    setUploads((prev) => prev.filter((upload) => upload.uploadId !== uploadId));
    finalizeSessionIfIdle();
  };

  const handleUploadComplete = async (
    documentData: DocumentData,
    uploadId: string,
  ) => {
    const pendingId = pendingUploadIds.current.get(uploadId);

    // Update status to processing (file uploaded to S3, now being processed by backend)
    if (pendingId) {
      updatePendingUpload(pendingId, {
        status: "processing",
        progress: 100,
      });
    }

    // Call the API to add the document to the dataroom
    try {
      const response = await fetch(`/api/links/${viewerData.linkId}/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documentData,
          dataroomId: viewerData.dataroomId,
          folderId: folderId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to process upload");
      }

      const result = await response.json();
      if (!result.document) {
        throw new Error("Upload response missing document metadata");
      }

      // Determine if the file needs trigger processing (PDF, docs, slides)
      // Images and Excel/CSV files are ready immediately after upload
      const FILE_TYPES_NEEDING_PROCESSING = ["pdf", "docs", "slides"];
      const needsProcessing = FILE_TYPES_NEEDING_PROCESSING.includes(
        result.document.fileType,
      );

      // Update pending upload with real document data
      if (pendingId) {
        updatePendingUpload(pendingId, {
          status: needsProcessing ? "processing" : "complete",
          documentId: result.document.id,
          dataroomDocumentId: result.document.dataroomDocumentId,
          documentVersionId: result.document.documentVersionId,
          fileType: result.document.fileType,
        });
      }

      settleUpload(uploadId, false);
    } catch (error) {
      console.error("Error processing upload:", error);
      toast.error((error as Error).message || "Failed to upload document");

      if (pendingId) {
        updatePendingUpload(pendingId, {
          status: "error",
          errorMessage: (error as Error).message || "Failed to upload document",
        });
      }

      settleUpload(uploadId, true);
    }
  };

  const isUploading = uploads.length > 0;

  return (
    <ViewerUploadZone
      onUploadStart={handleUploadStart}
      onUploadProgress={handleUploadProgress}
      onUploadComplete={handleUploadComplete}
      onUploadRejected={(rejected) => setRejectedFiles(rejected)}
      viewerData={viewerData}
      teamId={teamId}
    >
      {isUploading ? (
        <div className="min-w-0 space-y-3">
          {uploads.map((upload) => (
            <div
              key={upload.uploadId}
              className="flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <FileUp className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {upload.fileName}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Progress
                    value={upload.progress}
                    className="h-1.5 flex-1"
                  />
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {upload.progress}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className={cn(
            "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
            "border-gray-300 hover:border-gray-400 dark:border-gray-600 dark:hover:border-gray-500",
          )}
        >
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
            <FileUp className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">
            Drag & drop files here, or click to select files
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Supported: PDF, Office, spreadsheets, images, ZIP, and more
          </p>
        </div>
      )}

      {/* Display rejected files */}
      {rejectedFiles.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
          <p className="text-xs font-medium text-red-600 dark:text-red-400">
            Some files were rejected:
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {rejectedFiles.map((file, index) => (
              <li
                key={index}
                className="text-xs text-red-500 dark:text-red-400"
              >
                {file.fileName}: {file.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </ViewerUploadZone>
  );
}
