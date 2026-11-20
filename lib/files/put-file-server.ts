import { PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { DocumentStorageType } from "@prisma/client";
import { createReadStream } from "node:fs";
import path from "node:path";

import { newId } from "@/lib/id-helper";
import { buildContentDisposition, safeSlugify } from "@/lib/utils";

import { SUPPORTED_DOCUMENT_MIME_TYPES } from "../constants";
import { getTeamS3ClientAndConfig } from "./aws-client";
import { assertS3Transport } from "./transport";

// `File` is a web API type and not available server-side, so we need to define our own type
type File = {
  name: string;
  type: string;
  buffer: Buffer;
};

export const putFileServer = async ({
  file,
  teamId,
  docId,
  restricted = true,
  subfolder,
}: {
  file: File;
  teamId: string;
  docId?: string;
  restricted?: boolean;
  subfolder?: string;
}) => {
  assertS3Transport();

  const { type, data } = await putFileInS3Server({
    file,
    teamId,
    docId,
    restricted,
    subfolder,
  });

  return { type, data };
};

const putFileInS3Server = async ({
  file,
  teamId,
  docId,
  restricted = true,
  subfolder,
}: {
  file: File;
  teamId: string;
  docId?: string;
  restricted?: boolean;
  subfolder?: string;
}) => {
  if (!docId) {
    docId = newId("doc");
  }

  if (
    restricted &&
    file.type !== "image/png" &&
    file.type !== "image/jpeg" &&
    file.type !== "application/pdf"
  ) {
    throw new Error("Only PNG, JPEG, PDF or MP4 files are supported");
  }

  if (!restricted && !SUPPORTED_DOCUMENT_MIME_TYPES.includes(file.type)) {
    throw new Error("Unsupported file type");
  }

  const { client, config } = await getTeamS3ClientAndConfig(teamId);

  // Get the basename and extension for the file
  const { name, ext } = path.parse(file.name);

  const slugifiedName = safeSlugify(name) + ext;
  const originalFileName = `${name}${ext}`;
  const folderPrefix = subfolder ? `${safeSlugify(subfolder)}/` : "";
  const key = `${teamId}/${docId}/${folderPrefix}${slugifiedName}`;

  const params = {
    Bucket: config.bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.type,
    ContentDisposition: buildContentDisposition(
      originalFileName,
      slugifiedName,
    ),
  };

  // Create a new instance of the PutObjectCommand with the parameters
  const command = new PutObjectCommand(params);

  // Send the command to S3
  await client.send(command);

  return {
    type: DocumentStorageType.S3_PATH,
    data: key,
  };
};

// `File` variant that streams from a path on disk instead of holding the whole
// payload in a Buffer. Used for large media (videos) so memory stays flat.
type StreamFile = {
  name: string;
  type: string;
  path: string;
};

/**
 * Streaming counterpart to {@link putFileServer}. Reads the file from disk as a
 * stream and uploads it without buffering the whole payload in memory (via
 * multipart S3 upload through lib-storage).
 */
export const putFileServerStream = async ({
  file,
  teamId,
  docId,
  restricted = true,
  subfolder,
}: {
  file: StreamFile;
  teamId: string;
  docId?: string;
  restricted?: boolean;
  subfolder?: string;
}) => {
  assertS3Transport();

  const { type, data } = await putFileStreamInS3Server({
    file,
    teamId,
    docId,
    restricted,
    subfolder,
  });

  return { type, data };
};

const putFileStreamInS3Server = async ({
  file,
  teamId,
  docId,
  restricted = true,
  subfolder,
}: {
  file: StreamFile;
  teamId: string;
  docId?: string;
  restricted?: boolean;
  subfolder?: string;
}) => {
  if (!docId) {
    docId = newId("doc");
  }

  if (
    restricted &&
    file.type !== "image/png" &&
    file.type !== "image/jpeg" &&
    file.type !== "application/pdf"
  ) {
    throw new Error("Only PNG, JPEG, PDF or MP4 files are supported");
  }

  if (!restricted && !SUPPORTED_DOCUMENT_MIME_TYPES.includes(file.type)) {
    throw new Error("Unsupported file type");
  }

  const { client, config } = await getTeamS3ClientAndConfig(teamId);

  const { name, ext } = path.parse(file.name);

  const slugifiedName = safeSlugify(name) + ext;
  const originalFileName = `${name}${ext}`;
  const folderPrefix = subfolder ? `${safeSlugify(subfolder)}/` : "";
  const key = `${teamId}/${docId}/${folderPrefix}${slugifiedName}`;

  const upload = new Upload({
    client,
    params: {
      Bucket: config.bucket,
      Key: key,
      Body: createReadStream(file.path),
      ContentType: file.type,
      ContentDisposition: buildContentDisposition(
        originalFileName,
        slugifiedName,
      ),
    },
  });

  await upload.done();

  return {
    type: DocumentStorageType.S3_PATH,
    data: key,
  };
};
