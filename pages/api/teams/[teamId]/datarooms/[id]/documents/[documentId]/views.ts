import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { getTotalDataroomDuration } from "@/lib/tinybird";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/documents/:documentId/views
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const {
      teamId,
      id: dataroomId,
      documentId,
    } = req.query as {
      teamId: string;
      id: string;
      documentId: string;
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

      // Get all views for this document in this dataroom
      const views = await prisma.view.findMany({
        where: {
          dataroomId: dataroomId,
          documentId: documentId,
          viewType: "DOCUMENT_VIEW",
          isArchived: false,
        },
        orderBy: {
          viewedAt: "desc",
        },
        select: {
          id: true,
          viewerEmail: true,
          viewerName: true,
          viewedAt: true,
          downloadedAt: true,
          verified: true,
          versionNumber: true,
        },
      });

      // Get duration data for each view
      const viewsWithDuration = await Promise.all(
        views.map(async (view) => {
          let totalDuration = 0;
          try {
            const durationData = await getTotalDataroomDuration({
              dataroomId,
              documentId,
              viewId: view.id,
              since: 0,
            });
            totalDuration = durationData.data[0]?.sum_duration || 0;
          } catch (e) {
            // Ignore duration errors
          }

          return {
            ...view,
            totalDuration,
            numPages: dataroomDocument.document.versions[0]?.numPages || 0,
          };
        }),
      );

      return res.status(200).json({
        views: viewsWithDuration,
        documentName: dataroomDocument.document.name,
      });
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
