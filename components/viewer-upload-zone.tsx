import { useCallback } from "react";

import { DocumentStorageType } from "@prisma/client";
import { FileRejection, useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { VIEWER_ACCEPTED_FILE_TYPES } from "@/lib/constants";
import { DocumentData } from "@/lib/documents/create-document";
import { viewerUpload } from "@/lib/files/viewer-tus-upload";
import { newId } from "@/lib/id-helper";
import { cn } from "@/lib/utils";
import { getSupportedContentType } from "@/lib/utils/get-content-type";
import { getPagesCount } from "@/lib/utils/get-page-number-count";

// File types allowed for viewer uploads
const acceptableViewerFileTypes = VIEWER_ACCEPTED_FILE_TYPES;

export default function ViewerUploadZone({
  children,
  onUploadStart,
  onUploadProgress,
  onUploadComplete,
  onUploadRejected,
  viewerData,
  teamId,
  maxFileSize = 350, // 350 MB default, matches paid admin document limits
  disabled = false,
}: {
  children: React.ReactNode;
  onUploadStart: (
    uploads: { uploadId: string; fileName: string; progress: number }[],
  ) => void;
  onUploadProgress: (uploadId: string, progress: number) => void;
  onUploadComplete: (documentData: DocumentData, uploadId: string) => void;
  onUploadRejected: (rejected: { fileName: string; message: string }[]) => void;
  viewerData: {
    id: string;
    linkId: string;
    dataroomId?: string;
  };
  teamId: string;
  maxFileSize?: number;
  disabled?: boolean;
}) {
  const onDropRejected = useCallback(
    (rejectedFiles: FileRejection[]) => {
      const rejected = rejectedFiles.map(({ file, errors }) => {
        let message = "";
        if (errors.find(({ code }) => code === "file-too-large")) {
          message = `File size too big (max. ${maxFileSize} MB).`;
        } else if (errors.find(({ code }) => code === "file-invalid-type")) {
          message = `File type not supported.`;
        }
        return { fileName: file.name, message };
      });
      onUploadRejected(rejected);
    },
    [onUploadRejected, maxFileSize],
  );

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const trackedFiles = acceptedFiles.map((file) => ({
        uploadId: newId("pending"),
        file,
      }));

      const newUploads = trackedFiles.map(({ uploadId, file }) => ({
        uploadId,
        fileName: file.name,
        progress: 0,
      }));

      onUploadStart(newUploads);

      const uploadPromises = trackedFiles.map(async ({ uploadId, file }) => {
        // count the number of pages in the file
        let numPages = 1;
        if (file.type === "application/pdf") {
          const buffer = await file.arrayBuffer();
          numPages = await getPagesCount(buffer);
        }

        const { complete } = await viewerUpload({
          file,
          onProgress: (bytesUploaded, bytesTotal) => {
            const progress = Math.min(
              Math.round((bytesUploaded / bytesTotal) * 100),
              99,
            );
            onUploadProgress(uploadId, progress);
          },
          onError: (error) => {
            console.error("Upload error:", error);
            toast.error(`Failed to upload ${file.name}`);
          },
          viewerData,
          teamId,
          numPages,
        });

        const uploadResult = await complete;

        let contentType = uploadResult.fileType;
        let supportedFileType = getSupportedContentType(contentType) ?? "";

        if (uploadResult.fileName.endsWith(".xlsm")) {
          supportedFileType = "sheet";
          contentType = "application/vnd.ms-excel.sheet.macroEnabled.12";
        }

        const documentData: DocumentData = {
          key: uploadResult.id,
          supportedFileType: supportedFileType,
          name: file.name,
          storageType: DocumentStorageType.S3_PATH,
          contentType: contentType,
          fileSize: file.size,
          numPages: numPages,
        };

        onUploadComplete(documentData, uploadId);

        onUploadProgress(uploadId, 100); // Mark upload as complete

        return uploadResult;
      });

      try {
        await Promise.all(uploadPromises);
        toast.success("File upload complete!");
      } catch (error) {
        console.error("Upload error:", error);
        toast.error("An error occurred during upload");
      }
    },
    [onUploadStart, onUploadProgress, onUploadComplete, viewerData, teamId],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: acceptableViewerFileTypes,
    multiple: true,
    maxSize: maxFileSize * 1024 * 1024,
    onDrop,
    onDropRejected,
    disabled,
  });

  return (
    <div {...getRootProps()} className="relative min-w-0 min-h-[200px]">
      <div
        className={cn(
          "absolute inset-0 z-40 -m-1 rounded-lg border-2 border-dashed",
          isDragActive
            ? "pointer-events-auto border-primary/50 bg-gray-100/75 backdrop-blur-sm dark:bg-gray-800/75"
            : "pointer-events-none border-none",
        )}
      >
        <input
          {...getInputProps()}
          name="file"
          id="viewer-upload-files-zone"
          className="sr-only"
        />

        {isDragActive && (
          <div className="flex h-full items-center justify-center">
            <div className="inline-flex flex-col rounded-lg bg-background/95 px-6 py-4 text-center ring-1 ring-gray-900/5 dark:bg-gray-900/95 dark:ring-white/10">
              <span className="font-medium text-foreground">
                Drop your file(s) here
              </span>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                PDF, Office, images, TXT, LOG, ZIP, and more
              </p>
            </div>
          </div>
        )}
      </div>

      {children}
    </div>
  );
}
