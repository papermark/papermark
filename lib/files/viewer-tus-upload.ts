import * as tus from "tus-js-client";

import { decodeBase64Url } from "../utils/decode-base64url";

type ViewerUploadParams = {
  file: File;
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
  onError?: (error: Error | tus.DetailedError) => void;
  viewerData: {
    id: string;
    linkId: string;
    dataroomId?: string;
  };
  teamId: string;
  numPages: number;
  /** When set, the upload fulfills a Request List task. Task uploads are gated
   *  by assignment rather than the link's generic upload toggle. */
  taskId?: string;
};

type UploadResult = {
  id: string;
  url: string;
  fileName: string;
  fileType: string;
  numPages: number;
  viewerId: string;
  linkId: string;
  dataroomId?: string;
  teamId: string;
};

export function viewerUpload({
  file,
  onProgress,
  onError,
  viewerData,
  teamId,
  numPages,
  taskId,
}: ViewerUploadParams) {
  return new Promise<{ upload: tus.Upload; complete: Promise<UploadResult> }>(
    (resolve, reject) => {
      let completeResolve: (
        value: UploadResult | PromiseLike<UploadResult>,
      ) => void;
      const complete = new Promise<UploadResult>((res) => {
        completeResolve = res;
      });

      // Scope resumable uploads to this viewer/link/task so findPreviousUploads()
      // never reuses an upload created for a different task or viewer. The default
      // fingerprint only covers file name/type/size, which collides across tasks.
      const uploadScope = [
        teamId,
        viewerData.id,
        viewerData.linkId,
        viewerData.dataroomId || "",
        taskId || "",
      ].join(":");

      const upload = new tus.Upload(file, {
        endpoint: `${process.env.NEXT_PUBLIC_BASE_URL}/api/file/tus-viewer`,
        retryDelays: [0, 3000, 5000, 10000],
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        fingerprint: (file, options) =>
          Promise.resolve(
            [
              "tus-viewer",
              file.name,
              file.type,
              file.size,
              file.lastModified,
              options.endpoint,
              uploadScope,
            ].join("-"),
          ),
        metadata: {
          fileName: file.name,
          contentType: file.type,
          numPages: String(numPages),
          teamId: teamId,
          viewerId: viewerData.id,
          linkId: viewerData.linkId,
          dataroomId: viewerData.dataroomId || "",
          ...(taskId ? { taskId } : {}),
        },
        chunkSize: 4 * 1024 * 1024,
        onError: (error) => {
          onError && onError(error);
          console.error("Failed because: " + error);
          reject(error);
        },
        onShouldRetry(error, retryAttempt, options) {
          console.error(`Should retry upload. Attempt ${retryAttempt}`);
          var status = error.originalResponse
            ? error.originalResponse.getStatus()
            : 0;
          // Do not retry if the status is a 500 or 403.
          if (status === 500 || status === 403) {
            return false;
          }
          // For any other status code, we retry.
          return true;
        },
        onProgress,
        onSuccess: () => {
          console.log("Uploaded successfully");
          const id = upload.url!.split("/api/file/tus-viewer/")[1];
          // if id contains a slash, then we use it as it otherwise we need to convert from buffer base64URL to utf-8
          const newId = id.includes("/") ? id : decodeBase64Url(id);
          completeResolve({
            id: newId,
            url: upload.url!,
            fileName: file.name,
            fileType: file.type,
            numPages,
            viewerId: viewerData.id,
            linkId: viewerData.linkId,
            dataroomId: viewerData.dataroomId,
            teamId,
          });
        },
      });

      // Check if there are any previous uploads to continue.
      upload
        .findPreviousUploads()
        .then((previousUploads) => {
          // Only resume an upload whose stored metadata matches the current
          // task and viewer, so we never append to another task's upload.
          const resumable = previousUploads.find(
            (previous) =>
              (previous.metadata.taskId || "") === (taskId || "") &&
              previous.metadata.viewerId === viewerData.id &&
              previous.metadata.linkId === viewerData.linkId,
          );
          if (resumable) {
            upload.resumeFromPreviousUpload(resumable);
          }

          upload.start();
          resolve({ upload, complete });
        })
        .catch((error) => {
          console.error("Error finding previous uploads:", error);
          upload.start();
          resolve({ upload, complete });
        });
    },
  );
}
