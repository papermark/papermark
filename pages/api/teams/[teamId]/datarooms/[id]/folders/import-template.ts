import { NextApiRequest, NextApiResponse } from "next";

import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth/next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";

import { enforceDataroomMemberScope } from "@/lib/api/rbac/guard";
import { generateFolderImportTemplate } from "@/lib/folders/import-template";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

// GET /api/teams/:teamId/datarooms/:id/folders/import-template
// Streams a blank .xlsx template describing the folder-import format.
export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
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

  try {
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

    const { data, filename, mimeType } = await generateFolderImportTemplate();

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(data.byteLength));
    return res.status(200).send(Buffer.from(data));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("Folder import template failed:", error);
      return res
        .status(500)
        .json({ error: "DB_ERROR", message: "Failed to generate import template" });
    }
    console.error("Folder import template failed:", error);
    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Failed to generate import template",
    });
  }
}
