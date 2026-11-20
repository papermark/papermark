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

import { isTeamPausedById } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import { getLimits } from "@/ee/limits/server";
import {
  FREE_PLAN_ACCEPTED_FILE_TYPES,
  ONE_HOUR,
  ONE_SECOND,
  SUPPORTED_DOCUMENT_MIME_TYPES,
} from "@/lib/constants";
import { getTeamS3ClientAndConfig } from "@/lib/files/aws-client";
import { buildContentDisposition, safeSlugify } from "@/lib/utils";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import {
  getFileSizeLimit,
  getFileSizeLimits,
} from "@/lib/utils/get-file-size-limits";
import { MultipartUploadSchema } from "@/lib/zod/schemas/multipart";

import { authOptions } from "../../auth/[...nextauth]";

const FREE_PLAN = "free";
const FREE_TRIAL_PLAN = "free+drtrial";
const BYTES_PER_MEGABYTE = 1024 * 1024;

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
    const userId = (session.user as CustomUser).id;

    // Verify team access (and grab `plan` for the upload-time plan/size gates
    // applied below). `initiate` and `get-part-urls` are the points at which
    // server resources (multipart upload id, pre-signed PUT URLs) are issued,
    // so the gates run there; `complete` only ratifies an already-uploaded
    // object and doesn't need to re-run them.
    const team = await prisma.team.findUnique({
      where: {
        id: teamId,
        users: {
          some: {
            userId,
          },
        },
      },
      select: { id: true, plan: true },
    });

    if (!team) {
      return res.status(403).end("Unauthorized to access this team");
    }

    if (action === "initiate" || action === "get-part-urls") {
      const [limits, teamIsPaused] = await Promise.all([
        getLimits({ teamId, userId }),
        isTeamPausedById(teamId),
      ]);

      if (teamIsPaused) {
        return res.status(403).json({
          error:
            "Team is currently paused. New document uploads are not available.",
        });
      }

      const documentLimit = limits.documents;
      if (
        typeof documentLimit === "number" &&
        Number.isFinite(documentLimit) &&
        limits.usage.documents >= documentLimit
      ) {
        return res.status(403).json({
          error: "You have reached the team document limit",
        });
      }

      const isFree =
        team.plan === FREE_PLAN || team.plan === FREE_TRIAL_PLAN;
      const isTrial = team.plan.includes("drtrial");

      // Plan-eligibility gate. The client-side dropzone enforces the same
      // rule, but the folder picker bypasses dropzone and the multipart
      // endpoint signs PUT URLs that S3 will accept independently of any
      // later document-creation check — so we must re-enforce server-side.
      if (!SUPPORTED_DOCUMENT_MIME_TYPES.includes(contentType)) {
        return res.status(415).json({
          error: `File type ${contentType} is not supported`,
        });
      }
      if (
        isFree &&
        !isTrial &&
        !(contentType in FREE_PLAN_ACCEPTED_FILE_TYPES)
      ) {
        return res.status(415).json({
          error: `File type ${contentType} is not available on the free plan`,
        });
      }

      if (action === "get-part-urls") {
        const teamFileSizeLimitConfig: Parameters<
          typeof getFileSizeLimits
        >[0]["limits"] =
          "fileSizeLimits" in limits &&
          typeof limits.fileSizeLimits === "object" &&
          limits.fileSizeLimits !== null
            ? {
                fileSizeLimits: limits.fileSizeLimits as Record<
                  string,
                  number | undefined
                >,
              }
            : undefined;
        const fileSizeLimits = getFileSizeLimits({
          limits: teamFileSizeLimitConfig,
          isFree,
          isTrial,
        });
        const fileSizeLimitMb = getFileSizeLimit(contentType, fileSizeLimits);
        const fileSizeLimitBytes = fileSizeLimitMb * BYTES_PER_MEGABYTE;

        if (data.fileSize > fileSizeLimitBytes) {
          return res.status(413).json({
            error: `File size too big for ${contentType} (max. ${fileSizeLimitMb} MB)`,
          });
        }
      }
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
