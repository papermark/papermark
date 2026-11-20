import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { isDataroomScopedRole } from "@/lib/api/rbac/permissions";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId, query } = req.query as { teamId: string; query?: string };
    const userId = (session.user as CustomUser).id;

    try {
      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: userId,
            teamId: teamId,
          },
        },
      });

      if (!teamAccess) {
        return res.status(401).end("Unauthorized");
      }

      // Team-wide document search is not part of the dataroom-scoped surface.
      if (isDataroomScopedRole(teamAccess.role)) {
        return res
          .status(403)
          .json({ error: "You do not have permission to perform this action." });
      }

      // First, get documents without expensive counts
      const documents = await prisma.document.findMany({
        where: {
          teamId: teamId,
          name: {
            contains: query,
            mode: "insensitive",
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      // Then, get counts efficiently with separate GROUP BY queries
      const documentIds = documents.map((d) => d.id);

      const [linkCounts, viewCounts, versionCounts] = await Promise.all([
        prisma.link.groupBy({
          by: ["documentId"],
          where: {
            documentId: { in: documentIds },
            deletedAt: null,
          },
          _count: { id: true },
        }),
        prisma.view.groupBy({
          by: ["documentId"],
          where: {
            documentId: { in: documentIds },
          },
          _count: { id: true },
        }),
        prisma.documentVersion.groupBy({
          by: ["documentId"],
          where: {
            documentId: { in: documentIds },
          },
          _count: { id: true },
        }),
      ]);

      // Create lookup maps for counts
      const linkCountMap = new Map(
        linkCounts.map((lc) => [lc.documentId, lc._count.id]),
      );
      const viewCountMap = new Map(
        viewCounts.map((vc) => [vc.documentId, vc._count.id]),
      );
      const versionCountMap = new Map(
        versionCounts.map((vsc) => [vsc.documentId, vsc._count.id]),
      );

      // Combine documents with their counts
      const documentsWithCounts = documents.map((document) => ({
        ...document,
        _count: {
          links: linkCountMap.get(document.id) || 0,
          views: viewCountMap.get(document.id) || 0,
          versions: versionCountMap.get(document.id) || 0,
        },
      }));

      return res.status(200).json(documentsWithCounts);
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
