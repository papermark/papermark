import type { NextApiRequest, NextApiResponse } from "next";

import { isTeamPausedById } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import { getLimits } from "@/ee/limits/server";
import { MultiRegionS3Store } from "@/ee/features/storage/s3-store";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { Server } from "@tus/server";
import { getServerSession } from "next-auth/next";
import path from "node:path";

import { getTeamS3ClientAndConfig } from "@/lib/files/aws-client";
import { RedisLocker } from "@/lib/files/tus-redis-locker";
import { newId } from "@/lib/id-helper";
import prisma from "@/lib/prisma";
import { lockerRedisClient } from "@/lib/redis";
import { CustomUser } from "@/lib/types";
import { buildContentDisposition, log, safeSlugify } from "@/lib/utils";
import {
  getFileSizeLimit,
  getFileSizeLimits,
} from "@/lib/utils/get-file-size-limits";

import { authOptions } from "../../auth/[...nextauth]";

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: false,
  },
};

const locker = new RedisLocker({
  redisClient: lockerRedisClient,
});

const FREE_PLAN = "free";
const FREE_TRIAL_PLAN = "free+drtrial";
const BYTES_PER_MEGABYTE = 1024 * 1024;
type TusErrorResponse = { status_code: number; body: string };

type TusAuthenticatedRequest = NextApiRequest & {
  papermarkUserId?: string;
};

const tusServer = new Server({
  // `path` needs to match the route declared by the next file router
  path: "/api/file/tus",
  maxSize: 1024 * 1024 * 1024 * 2, // 2 GiB
  respectForwardedHeaders: true,
  locker,
  datastore: new MultiRegionS3Store(),
  namingFunction(req, metadata) {
    const { teamId, fileName } = metadata as {
      teamId: string;
      fileName: string;
    };
    const docId = newId("doc");
    const { name, ext } = path.parse(fileName);
    const newName = `${teamId}/${docId}/${safeSlugify(name)}${ext}`;
    return newName;
  },
  generateUrl(req, { proto, host, path, id }) {
    // Encode the ID to be URL safe
    id = Buffer.from(id, "utf-8").toString("base64url");
    return `${proto}://${host}${path}/${id}`;
  },
  getFileIdFromRequest(req) {
    // Extract the ID from the URL
    const id = (req.url as string).split("/api/file/tus/")[1];
    return Buffer.from(id, "base64url").toString("utf-8");
  },
  onResponseError(req, res, err) {
    if (typeof err === "object" && err !== null) {
      const tusError = err as { status_code?: unknown; body?: unknown };
      if (
        typeof tusError.status_code === "number" &&
        typeof tusError.body === "string"
      ) {
        const errorResponse: TusErrorResponse = {
          status_code: tusError.status_code,
          body: tusError.body,
        };
        return errorResponse;
      }
    }

    log({
      message: "Error uploading a file. Error: \n\n" + err,
      type: "error",
    });
    return { status_code: 500, body: "Internal Server Error" };
  },
  async onIncomingRequest(req, res, uploadId) {
    const userId = (req as TusAuthenticatedRequest).papermarkUserId;
    if (!userId) {
      throw { status_code: 401, body: "Unauthorized" };
    }

    // Upload creation is validated in onUploadCreate; here we protect follow-up
    // requests (HEAD/PATCH/DELETE) so only team members can touch an upload URL.
    if (!uploadId || req.method === "POST") {
      return;
    }

    const decodedUploadId = uploadId.includes("/")
      ? uploadId
      : Buffer.from(uploadId, "base64url").toString("utf-8");
    const uploadTeamId = decodedUploadId.split("/")[0];

    if (!uploadTeamId) {
      throw { status_code: 400, body: "Invalid upload id" };
    }

    const hasTeamAccess = await prisma.userTeam.findUnique({
      where: {
        userId_teamId: {
          userId,
          teamId: uploadTeamId,
        },
      },
      select: {
        userId: true,
      },
    });

    if (!hasTeamAccess) {
      throw { status_code: 403, body: "Unauthorized to access this team" };
    }
  },
  async onUploadCreate(req, res, upload) {
    const userId = (req as TusAuthenticatedRequest).papermarkUserId;
    if (!userId) {
      throw { status_code: 401, body: "Unauthorized" };
    }

    const metadata = upload.metadata || {};
    const teamId = metadata.teamId;
    const fileName = metadata.fileName;
    const contentType = metadata.contentType || "application/octet-stream";

    if (!teamId || !fileName) {
      throw { status_code: 400, body: "Missing required upload metadata" };
    }

    const team = await prisma.team.findUnique({
      where: {
        id: teamId,
        users: {
          some: {
            userId,
          },
        },
      },
      select: {
        plan: true,
      },
    });

    if (!team) {
      throw { status_code: 403, body: "Unauthorized to access this team" };
    }

    const [limits, teamIsPaused] = await Promise.all([
      getLimits({ teamId, userId }),
      isTeamPausedById(teamId),
    ]);

    if (teamIsPaused) {
      throw {
        status_code: 403,
        body: "Team is currently paused. New document uploads are not available.",
      };
    }

    const documentLimit = limits.documents;
    if (
      typeof documentLimit === "number" &&
      Number.isFinite(documentLimit) &&
      limits.usage.documents >= documentLimit
    ) {
      throw {
        status_code: 403,
        body: "You have reached the team document limit",
      };
    }

    const uploadSize = upload.size;
    if (
      typeof uploadSize !== "number" ||
      !Number.isFinite(uploadSize) ||
      uploadSize <= 0
    ) {
      throw { status_code: 400, body: "Missing or invalid upload length" };
    }

    const isFree = team.plan === FREE_PLAN || team.plan === FREE_TRIAL_PLAN;
    const isTrial = team.plan.includes("drtrial");
    const teamFileSizeLimitConfig: Parameters<typeof getFileSizeLimits>[0]["limits"] =
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

    if (uploadSize > fileSizeLimitBytes) {
      throw {
        status_code: 413,
        body: `File size too big for ${contentType} (max. ${fileSizeLimitMb} MB)`,
      };
    }

    return res;
  },
  async onUploadFinish(req, res, upload) {
    try {
      const metadata = upload.metadata || {};
      const contentType = metadata.contentType || "application/octet-stream";
      const { name, ext } = path.parse(metadata.fileName!);
      const originalFileName = `${name}${ext}`;
      const contentDisposition = buildContentDisposition(
        originalFileName,
        `${safeSlugify(name)}${ext}`,
      );

      // The Key (object path) where the file was uploaded
      const objectKey = upload.id;

      // Extract teamId from the object key (format: teamId/docId/filename)
      const teamId = objectKey.split("/")[0];
      if (!teamId) {
        throw { status_code: 500, body: "Invalid object key format" };
      }

      // Get team-specific S3 client and config
      const { client, config } = await getTeamS3ClientAndConfig(teamId);

      // Copy the object onto itself, replacing the metadata
      const params = {
        Bucket: config.bucket,
        CopySource: `${config.bucket}/${objectKey}`,
        Key: objectKey,
        ContentType: contentType,
        ContentDisposition: contentDisposition,
        MetadataDirective: "REPLACE" as const,
      };

      const copyCommand = new CopyObjectCommand(params);
      await client.send(copyCommand);

      return res;
    } catch (error) {
      throw { status_code: 500, body: "Error updating metadata" };
    }
  },
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Get the session
  const session = await getServerSession(req, res, authOptions);
  const userId = (session?.user as CustomUser | undefined)?.id;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  (req as TusAuthenticatedRequest).papermarkUserId = userId;

  return tusServer.handle(req, res);
}
