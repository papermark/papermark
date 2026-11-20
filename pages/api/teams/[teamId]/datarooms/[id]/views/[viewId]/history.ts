import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/views/:viewId/history
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const {
      teamId,
      id: dataroomId,
      viewId,
    } = req.query as {
      teamId: string;
      id: string;
      viewId: string;
    };

    const userId = (session.user as CustomUser).id;

    try {
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: (session.user as CustomUser).id,
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

      const [documentViews, uploadedDocumentViews] = await Promise.all([
        prisma.view.findMany({
          where: {
            dataroomViewId: viewId,
            dataroomId: dataroomId,
            viewType: "DOCUMENT_VIEW",
          },
          orderBy: {
            viewedAt: "asc",
          },
          select: {
            id: true,
            viewedAt: true,
            downloadedAt: true,
            downloadType: true,
            downloadMetadata: true,
            document: {
              select: {
                id: true,
                name: true,
                type: true,
                versions: {
                  where: { isPrimary: true },
                  take: 1,
                  select: { type: true },
                },
              },
            },
          },
        }),
        prisma.documentUpload.findMany({
          where: {
            viewId: viewId,
          },
          select: {
            uploadedAt: true,
            documentId: true,
            originalFilename: true,
          },
        }),
      ]);

      return res.status(200).json({ documentViews, uploadedDocumentViews });
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    // We only allow GET and POST requests
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
