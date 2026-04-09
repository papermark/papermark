import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { getViewPageDuration } from "@/lib/tinybird";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/documents/:documentId/views/:viewId/stats
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const {
      teamId,
      id: dataroomId,
      documentId,
      viewId,
    } = req.query as {
      teamId: string;
      id: string;
      documentId: string;
      viewId: string;
    };

    const userId = (session.user as CustomUser).id;

    try {
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: userId,
            },
          },
        },
        select: {
          id: true,
        },
      });

      if (!team) {
        return res.status(403).end("Unauthorized to access this team");
      }

      // Verify the document exists in this dataroom
      const dataroomDocument = await prisma.dataroomDocument.findFirst({
        where: {
          dataroomId: dataroomId,
          documentId: documentId,
        },
        select: {
          id: true,
          document: {
            select: {
              id: true,
              name: true,
              versions: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                  numPages: true,
                  versionNumber: true,
                },
              },
            },
          },
        },
      });

      if (!dataroomDocument) {
        return res.status(404).json({ error: "Document not found in dataroom" });
      }

      const duration = await getViewPageDuration({
        documentId: documentId,
        viewId: viewId,
        since: 0,
      });

      const total_duration = duration.data.reduce(
        (totalDuration, data) => totalDuration + data.sum_duration,
        0,
      );

      const numPages = dataroomDocument.document.versions[0]?.numPages || 0;
      const versionNumber = dataroomDocument.document.versions[0]?.versionNumber;

      const stats = {
        duration,
        total_duration,
        numPages,
        versionNumber,
        documentName: dataroomDocument.document.name,
      };

      return res.status(200).json(stats);
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
