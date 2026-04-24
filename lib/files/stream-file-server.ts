import { Upload } from "@aws-sdk/lib-storage";
import { DocumentStorageType } from "@prisma/client";
import path from "node:path";
import { Readable } from "stream";

import { buildContentDisposition, safeSlugify } from "@/lib/utils";

import { getTeamS3ClientAndConfig } from "./aws-client";

type StreamFile = {
  name: string;
  type: string;
  stream: Readable;
};

export const streamFileServer = async ({
  file,
  teamId,
  docId,
}: {
  file: StreamFile;
  teamId: string;
  docId: string;
}) => {
  const { client, config } = await getTeamS3ClientAndConfig(teamId);

  // Get the basename and extension for the file
  const { name, ext } = path.parse(file.name);

  const slugifiedName = safeSlugify(name) + ext;
  const originalFileName = `${name}${ext}`;
  const key = `${teamId}/${docId}/${slugifiedName}`;

  const params = {
    client,
    params: {
      Bucket: config.bucket,
      Key: key,
      Body: file.stream,
      ContentType: file.type,
      ContentDisposition: buildContentDisposition(
        originalFileName,
        slugifiedName,
      ),
    },
  };

  // Use Upload for multipart upload support
  const upload = new Upload(params);

  // Send the upload to S3
  await upload.done();

  return {
    type: DocumentStorageType.S3_PATH,
    data: key,
  };
};
