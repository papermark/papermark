import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { z } from "zod";

import { enforceDataroomMemberScope } from "@/lib/api/rbac/guard";
import {
  BulkFolderInput,
  BulkValidationError,
  MAX_BULK_FOLDERS_PER_REQUEST,
  bulkCreateDataroomFolders,
  getSafeBulkValidationMessage,
} from "@/lib/folders/bulk-create";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import { CustomUser } from "@/lib/types";

const BulkSchema = z.object({
  /**
   * Path of the parent folder under which to create the tree.
   * Empty string / undefined means dataroom root. Leading slash optional.
   */
  rootPath: z.string().max(2000).optional(),
  folders: z
    .array(
      z.object({
        tempId: z.string().min(1).max(64),
        name: z.string().min(1).max(255),
        parentTempId: z.string().min(1).max(64).optional().nullable(),
        /**
         * Absolute path of an existing folder (e.g. created by a prior bulk
         * chunk) — used by the client when splitting very large trees across
         * multiple requests. Ignored if `parentTempId` is set.
         */
        parentPath: z.string().min(1).max(2000).optional().nullable(),
        /**
         * Position among the folder's siblings within this request, counting
         * from 0. Folders landing directly under `rootPath` get shifted past
         * the items already there, so an import never reorders what the user
         * already arranged. Omitted/null leaves orderIndex null.
         */
        orderIndex: z
          .number()
          .int()
          .min(0)
          .max(MAX_BULK_FOLDERS_PER_REQUEST)
          .optional()
          .nullable(),
      }),
    )
    .min(1)
    .max(MAX_BULK_FOLDERS_PER_REQUEST),
});

function normaliseRootPath(input: string | undefined): string {
  if (!input) return "/";
  const trimmed = input.trim();
  if (trimmed === "" || trimmed === "/") return "/";
  return trimmed.startsWith("/") ? trimmed : "/" + trimmed;
}

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const userId = (session.user as CustomUser).id;
  const { teamId, id: dataroomId } = req.query as {
    teamId: string;
    id: string;
  };

  const parsed = BulkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
  }

  const rootPath = normaliseRootPath(parsed.data.rootPath);
  const inputFolders: BulkFolderInput[] = parsed.data.folders;

  try {
    // Scoped members may only create folders within their assigned rooms,
    // mirroring the single-folder POST in folders/index.ts.
    if (await enforceDataroomMemberScope({ userId, teamId, dataroomId, res })) {
      return;
    }

    const team = await prisma.team.findUnique({
      where: {
        id: teamId,
        users: { some: { userId } },
        datarooms: { some: { id: dataroomId } },
      },
      select: { id: true },
    });

    if (!team) {
      return res.status(401).end("Unauthorized");
    }

    // 10/min allows ~10 chunks per drop (with MAX_BULK_FOLDERS_PER_REQUEST
    // = 500 that's up to ~5,000 folders/min per user per dataroom); higher
    // bursts are unusual and worth throttling.
    const { success } = await ratelimit(10, "1 m").limit(
      `bulk-dataroom-folders:${teamId}:${dataroomId}:${userId}`,
    );
    if (!success) {
      return res.status(429).json({
        error: "RATE_LIMITED",
        message: "Too many bulk folder requests. Please try again shortly.",
      });
    }

    const created = await prisma.$transaction(
      async (tx) => {
        let rootParentId: string | null = null;
        if (rootPath !== "/") {
          const parent = await tx.dataroomFolder.findUnique({
            where: { dataroomId_path: { dataroomId, path: rootPath } },
            select: { id: true },
          });
          if (!parent) {
            throw new BulkValidationError(
              "UNKNOWN_ROOT_PATH",
              "Parent folder does not exist",
            );
          }
          rootParentId = parent.id;
        }

        return bulkCreateDataroomFolders({
          tx,
          dataroomId,
          rootPath,
          rootParentId,
          folders: inputFolders,
        });
      },
      // A full 500-folder batch runs one SELECT + one INSERT per tree level
      // plus the ACL createMany. Prisma's 5s default leaves no headroom for
      // that many round trips over a pooled connection, and blowing it rolls
      // back the whole import.
      { timeout: 20_000, maxWait: 10_000 },
    );

    return res.status(201).json({ folders: created });
  } catch (error) {
    if (error instanceof BulkValidationError) {
      return res.status(400).json({
        error: error.code,
        message: getSafeBulkValidationMessage(error.code),
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("Bulk dataroom folder create failed:", error);
      return res
        .status(500)
        .json({ error: "DB_ERROR", message: "Failed to create folders" });
    }
    console.error("Bulk dataroom folder create failed:", error);
    return res
      .status(500)
      .json({ error: "INTERNAL_ERROR", message: "Failed to create folders" });
  }
}
