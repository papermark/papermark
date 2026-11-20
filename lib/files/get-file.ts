import { DocumentStorageType } from "@prisma/client";
import { getDownloadUrl } from "@vercel/blob";
import { match } from "ts-pattern";

export type GetFileOptions = {
  type: DocumentStorageType;
  data: string;
  isDownload?: boolean;
  /** Signed URL lifetime in milliseconds (server-side S3 only, capped at 1 hour) */
  expiresIn?: number;
  /**
   * Override the Content-Disposition returned for this single download.
   * Only honored for S3-backed documents on origins that are not fronted by
   * CloudFront (CloudFront strips/ignores the override).
   */
  responseContentDisposition?: string;
};

export const getFile = async ({
  type,
  data,
  isDownload = false,
  expiresIn,
  responseContentDisposition,
}: GetFileOptions): Promise<string> => {
  const url = await match(type)
    .with(DocumentStorageType.VERCEL_BLOB, () => {
      if (isDownload) {
        return getDownloadUrl(data);
      } else {
        return data;
      }
    })
    .with(DocumentStorageType.S3_PATH, async () =>
      getFileFromS3(data, expiresIn, responseContentDisposition),
    )
    .exhaustive();

  return url;
};

const fetchPresignedUrl = async (
  endpoint: string,
  headers: Record<string, string>,
  key: string,
  expiresIn?: number,
  responseContentDisposition?: string,
): Promise<string> => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      key,
      ...(expiresIn && { expiresIn }),
      ...(responseContentDisposition && { responseContentDisposition }),
    }),
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type");
    let errorMessage: string;

    if (contentType && contentType.includes("application/json")) {
      try {
        const error = await response.json();
        errorMessage =
          error.message || `Request failed with status ${response.status}`;
      } catch (parseError) {
        const textError = await response.text();
        errorMessage =
          textError || `Request failed with status ${response.status}`;
      }
    } else {
      const textError = await response.text();
      errorMessage =
        textError || `Request failed with status ${response.status}`;
    }

    throw new Error(errorMessage);
  }

  const { url } = (await response.json()) as { url: string };
  return url;
};

const getFileFromS3 = async (
  key: string,
  expiresIn?: number,
  responseContentDisposition?: string,
) => {
  const isServer =
    typeof window === "undefined" && !!process.env.INTERNAL_API_KEY;

  if (isServer) {
    return fetchPresignedUrl(
      `${process.env.NEXT_PUBLIC_BASE_URL}/api/file/s3/get-presigned-get-url`,
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
      },
      key,
      expiresIn,
      responseContentDisposition,
    );
  } else {
    return fetchPresignedUrl(
      `/api/file/s3/get-presigned-get-url-proxy`,
      {
        "Content-Type": "application/json",
      },
      key,
      undefined,
      responseContentDisposition,
    );
  }
};
