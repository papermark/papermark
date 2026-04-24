import { PutObjectCommand } from "@aws-sdk/client-s3";
import { DocumentStorageType } from "@prisma/client";
import { put } from "@vercel/blob";
import path from "node:path";
import { match } from "ts-pattern";

import { newId } from "@/lib/id-helper";
import { buildContentDisposition, safeSlugify } from "@/lib/utils";

import { SUPPORTED_DOCUMENT_MIME_TYPES } from "../constants";
import { getTeamS3ClientAndConfig } from "./aws-client";

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
}: {
  file: File;
  teamId: string;
  docId?: string;
  restricted?: boolean;
}) => {
  const NEXT_PUBLIC_UPLOAD_TRANSPORT = process.env.NEXT_PUBLIC_UPLOAD_TRANSPORT;

  const { type, data } = await match(NEXT_PUBLIC_UPLOAD_TRANSPORT)
    .with("s3", async () =>
      putFileInS3Server({ file, teamId, docId, restricted }),
    )
    .with("vercel", async () => putFileInVercelServer(file))
    .otherwise(() => {
      return {
        type: null,
        data: null,
        numPages: undefined,
      };
    });

  return { type, data };
};

const putFileInVercelServer = async (file: File) => {
  const contents = file.buffer;

  const blob = await put(file.name, contents, {
    access: "public",
    addRandomSuffix: true,
  });

  return {
    type: DocumentStorageType.VERCEL_BLOB,
    data: blob.url,
  };
};

const putFileInS3Server = async ({
  file,
  teamId,
  docId,
  restricted = true,
}: {
  file: File;
  teamId: string;
  docId?: string;
  restricted?: boolean;
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
  const key = `${teamId}/${docId}/${slugifiedName}`;

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
