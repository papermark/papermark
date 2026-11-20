import { NextApiRequest, NextApiResponse } from "next";

import { withTeamApi } from "@/lib/api/auth/with-session-team";
import prisma from "@/lib/prisma";

// PATCH /api/teams/:teamId/datarooms/:id/documents/move
const patchHandler = withTeamApi(
  async ({ req, res, teamId }) => {
    const { id: dataroomId } = req.query as { id: string };
    const { documentIds, folderId } = req.body as {
      documentIds: string[];
      folderId: string | null;
    };

    // Ensure the dataroom belongs to the team.
    const dataroom = await prisma.dataroom.findUnique({
      where: { id: dataroomId, teamId },
      select: { id: true },
    });
    if (!dataroom) {
      return res.status(403).end("Forbidden");
    }

    // Update the folderId for the specified documents
    const updatedDocuments = await prisma.dataroomDocument.updateMany({
      where: {
        id: { in: documentIds },
        dataroomId: dataroomId,
      },
      data: {
        folderId: folderId,
        orderIndex: null,
      },
    });

    // Get new path for folder unless folderId is null
    let folder: { path: string } | null = null;
    if (folderId) {
      folder = await prisma.dataroomFolder.findUnique({
        where: { id: folderId, dataroomId: dataroomId },
        select: { path: true },
      });
    }

    if (updatedDocuments.count === 0) {
      return res.status(404).end("No documents were updated");
    }

    return res.status(200).json({
      message: "Document moved successfully",
      updatedCount: updatedDocuments.count,
      newPath: folder?.path,
    });
  },
  // Moving documents is a room-manager action: scoped members may do it within
  // an assigned room (canManageDataroom), full roles anywhere.
  { requiredPermissions: ["datarooms.write"], dataroomParam: "id" },
);

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "PATCH") {
    return patchHandler(req, res);
  } else {
    res.setHeader("Allow", ["PATCH"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
