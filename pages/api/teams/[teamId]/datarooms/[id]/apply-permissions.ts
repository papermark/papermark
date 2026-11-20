import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { DefaultPermissionStrategy } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth";

import { revalidateLinksForDataroom } from "@/lib/api/links/revalidate";
import { applyDataroomDocumentPermissionDefaults } from "@/lib/dataroom/apply-default-permissions";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export const config = {
  // in order to enable `waitUntil` function
  supportsResponseStreaming: true,
};

const VALID_STRATEGIES = new Set<string>([
  "INHERIT_FROM_PARENT",
  "ASK_EVERY_TIME",
  "HIDDEN_BY_DEFAULT",
]);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { teamId, id: dataroomId } = req.query as {
    teamId: string;
    id: string;
  };

  const userId = (session.user as CustomUser).id;

  try {
    // `folderPath` is still sent by older clients but no longer trusted; the
    // containing folder is resolved from each document's own `folderId`.
    const { documentIds, strategy, groupStrategy, linkStrategy } = req.body as {
      documentIds: string[];
      strategy?: string;
      groupStrategy?: string;
      linkStrategy?: string;
      folderPath?: string;
    };

    // Validate input
    if (
      !documentIds ||
      !Array.isArray(documentIds) ||
      documentIds.length === 0
    ) {
      return res.status(400).json({ message: "Document IDs are required" });
    }

    // Validate all provided strategies
    for (const value of [strategy, groupStrategy, linkStrategy]) {
      if (value !== undefined && !VALID_STRATEGIES.has(value)) {
        return res.status(400).json({ message: "Invalid strategy" });
      }
    }

    // Check if the user is part of the team
    const team = await prisma.team.findFirst({
      where: {
        id: teamId,
        users: { some: { userId } },
      },
    });

    if (!team) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Get dataroom and verify it exists and belongs to the team
    const dataroom = await prisma.dataroom.findUnique({
      where: { id: dataroomId },
      select: {
        id: true,
        teamId: true,
        defaultPermissionStrategy: true,
        defaultGroupPermissionStrategy: true,
        defaultRootItemAccess: true,
        defaultGroupRootItemAccess: true,
      },
    });

    if (!dataroom || dataroom.teamId !== teamId) {
      return res.status(404).json({ message: "Dataroom not found" });
    }

    // Resolve effective strategies. Precedence:
    //   1. Explicit per-target strategy from the request body.
    //   2. Legacy `strategy` field (applied to both targets) for backward
    //      compatibility with older clients that didn't know about the split.
    //   3. The dataroom's stored defaults.
    const effectiveGroupStrategy =
      (groupStrategy as DefaultPermissionStrategy | undefined) ??
      (strategy as DefaultPermissionStrategy | undefined) ??
      dataroom.defaultGroupPermissionStrategy;
    const effectiveLinkStrategy =
      (linkStrategy as DefaultPermissionStrategy | undefined) ??
      (strategy as DefaultPermissionStrategy | undefined) ??
      dataroom.defaultPermissionStrategy;

    // Get dataroom documents for the provided document IDs
    const dataroomDocuments = await prisma.dataroomDocument.findMany({
      where: {
        documentId: { in: documentIds },
        dataroomId,
      },
      select: { id: true, folderId: true },
    });

    if (dataroomDocuments.length === 0) {
      return res
        .status(404)
        .json({ message: "No documents found in this dataroom" });
    }

    await applyDataroomDocumentPermissionDefaults({
      dataroomId,
      dataroomDocuments,
      groupStrategy: effectiveGroupStrategy,
      groupRootItemAccess: dataroom.defaultGroupRootItemAccess,
      linkStrategy: effectiveLinkStrategy,
      linkRootItemAccess: dataroom.defaultRootItemAccess,
    });

    // Revalidate ISR pages for links with permission restrictions off the
    // request path so the response returns without waiting for it.
    waitUntil(revalidateLinksForDataroom(dataroomId));

    return res.status(200).json({
      message: "Permissions applied successfully",
      documentsProcessed: dataroomDocuments.length,
      groupStrategy: effectiveGroupStrategy,
      linkStrategy: effectiveLinkStrategy,
    });
  } catch (error) {
    errorhandler(error, res);
  }
}
