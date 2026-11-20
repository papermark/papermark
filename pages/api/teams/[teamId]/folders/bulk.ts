import { NextApiRequest, NextApiResponse } from "next";

import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { z } from "zod";

import { authOptions } from "@/pages/api/auth/[...nextauth]";

import {
  BulkFolderInput,
  BulkValidationError,
  MAX_BULK_FOLDERS_PER_REQUEST,
  bulkCreateMainDocsFolders,
  getSafeBulkValidationMessage,
} from "@/lib/folders/bulk-create";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import { CustomUser } from "@/lib/types";

const BulkSchema = z.object({
  rootPath: z.string().max(2000).optional(),
  folders: z
    .array(
      z.object({
        tempId: z.string().min(1).max(64),
        name: z.string().min(1).max(255),
        parentTempId: z.string().min(1).max(64).optional().nullable(),
        parentPath: z.string().min(1).max(2000).optional().nullable(),
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
  const { teamId } = req.query as { teamId: string };

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
    const teamAccess = await prisma.userTeam.findUnique({
      where: { userId_teamId: { userId, teamId } },
      select: { teamId: true },
    });
    if (!teamAccess) {
      return res.status(401).end("Unauthorized");
    }

    // See dataroom variant for the rationale on 10/min.
    const { success } = await ratelimit(10, "1 m").limit(
      `bulk-folders:${teamId}:${userId}`,
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
          const parent = await tx.folder.findUnique({
            where: { teamId_path: { teamId, path: rootPath } },
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

        return bulkCreateMainDocsFolders({
          tx,
          teamId,
          rootPath,
          rootParentId,
          folders: inputFolders,
        });
      },
      // See the dataroom variant: Prisma's 5s default is too tight for a
      // full 500-folder batch over a pooled connection.
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
      console.error("Bulk main-docs folder create failed:", error);
      return res
        .status(500)
        .json({ error: "DB_ERROR", message: "Failed to create folders" });
    }
    console.error("Bulk main-docs folder create failed:", error);
    return res
      .status(500)
      .json({ error: "INTERNAL_ERROR", message: "Failed to create folders" });
  }
}
