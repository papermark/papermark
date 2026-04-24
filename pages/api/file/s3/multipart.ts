import { NextApiRequest, NextApiResponse } from "next";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerSession } from "next-auth";
import path from "node:path";

import { ONE_HOUR, ONE_SECOND } from "@/lib/constants";
import { getTeamS3ClientAndConfig } from "@/lib/files/aws-client";
import { buildContentDisposition, safeSlugify } from "@/lib/utils";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { MultipartUploadSchema } from "@/lib/zod/schemas/multipart";

import { authOptions } from "../../auth/[...nextauth]";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).end("Method Not Allowed");
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  try {
    // Validate request body with Zod
    const validationResult = MultipartUploadSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: validationResult.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const data = validationResult.data;
    const { action, fileName, contentType, teamId, docId } = data;

    // Verify team access
    const team = await prisma.team.findUnique({
      where: {
        id: teamId,
        users: {
          some: {
            userId: (session.user as CustomUser).id,
          },
        },
      },
      select: { id: true },
    });

    if (!team) {
      return res.status(403).end("Unauthorized to access this team");
    }

    // Get the basename and extension for the file
    const { name, ext } = path.parse(fileName);
    const slugifiedName = safeSlugify(name) + ext;
    const originalFileName = `${name}${ext}`;
    const key = `${team.id}/${docId}/${slugifiedName}`;

    const { client, config } = await getTeamS3ClientAndConfig(team.id);

    switch (action) {
      case "initiate": {
        // Step 1: Start multipart upload
        const createCommand = new CreateMultipartUploadCommand({
          Bucket: config.bucket,
          Key: key,
          ContentType: contentType,
          ContentDisposition: buildContentDisposition(
            originalFileName,
            slugifiedName,
          ),
        });

        const createResponse = await client.send(createCommand);

        return res.status(200).json({
          uploadId: createResponse.UploadId,
          key,
          fileName: slugifiedName,
        });
      }

      case "get-part-urls": {
        // Step 2: Generate pre-signed URLs for each part
        if (data.action !== "get-part-urls") {
          return res.status(400).json({ error: "Invalid action" });
        }

        const { uploadId, fileSize, partSize } = data;

        const numParts = Math.ceil(fileSize / partSize);
        const urls = await Promise.all(
          Array.from({ length: numParts }, async (_, index) => {
            const partNumber = index + 1;
            const command = new UploadPartCommand({
              Bucket: config.bucket,
              Key: key,
              PartNumber: partNumber,
              UploadId: uploadId,
            });

            const url = await getSignedUrl(client, command, {
              expiresIn: ONE_HOUR / ONE_SECOND,
            });

            return { partNumber, url };
          }),
        );

        return res.status(200).json({ urls });
      }

      case "complete": {
        // Step 3: Complete multipart upload
        if (data.action !== "complete") {
          return res.status(400).json({ error: "Invalid action" });
        }

        const { uploadId, parts } = data;

        const completeCommand = new CompleteMultipartUploadCommand({
          Bucket: config.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
          },
        });

        try {
          await client.send(completeCommand);

          return res.status(200).json({
            success: true,
            key,
            fileName: slugifiedName,
          });
        } catch (completeError) {
          console.error("Failed to complete multipart upload:", completeError);

          // Cleanup: Abort the multipart upload to prevent storage costs
          try {
            const abortCommand = new AbortMultipartUploadCommand({
              Bucket: config.bucket,
              Key: key,
              UploadId: uploadId,
            });

            await client.send(abortCommand);
            console.log(`Successfully aborted multipart upload: ${uploadId}`);
          } catch (abortError) {
            console.error("Failed to abort multipart upload:", abortError);
            // Log but don't fail the request - the upload already failed
          }

          return res.status(500).json({
            error: "Failed to complete multipart upload",
            details:
              completeError instanceof Error
                ? completeError.message
                : "Unknown error",
          });
        }
      }

      default:
        return res.status(400).json({ error: "Invalid action" });
    }
  } catch (error) {
    console.error("Multipart upload error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
