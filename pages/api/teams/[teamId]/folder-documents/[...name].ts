import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { folderPathSchema } from "@/lib/zod/schemas/folders";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/folder-documents/:name
    //
    // See dataroom variant for why this sits outside the `folders/`
    // namespace.
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const userId = (session.user as CustomUser).id;
    const { teamId, name } = req.query as { teamId: string; name: string[] };

    // Validate that name is an array of strings using shared Zod schema
    const nameValidation = folderPathSchema.safeParse(name);
    if (!nameValidation.success) {
      return res.status(400).json({
        error: "Invalid folder path format",
        details: nameValidation.error.issues.map((issue) => issue.message),
      });
    }

    const validatedName = nameValidation.data;
    const path = "/" + validatedName.join("/"); // construct the materialized path

    try {
      // Check if the user is part of the team
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

      const folder = await prisma.folder.findUnique({
        where: {
          teamId_path: {
            teamId: teamId,
            path: path,
          },
        },
        select: {
          id: true,
          parentId: true,
        },
      });

      if (!folder) {
        return res.status(404).end("Folder not found");
      }

      // First, get documents without expensive counts
      const documents = await prisma.document.findMany({
        where: {
          teamId: teamId,
          folderId: folder.id,
          hiddenInAllDocuments: false, // Exclude hidden documents from All Documents folder view
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      // Then, get counts efficiently with separate GROUP BY queries
      const documentIds = documents.map((d) => d.id);
      if (documentIds.length === 0) {
        return res.status(200).json([]);
      }

      const [linkCounts, viewCounts, versionCounts, dataroomCounts] =
        await Promise.all([
          prisma.link.groupBy({
            by: ["documentId"],
            where: {
              documentId: { in: documentIds },
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
          prisma.dataroomDocument.groupBy({
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
      const dataroomCountMap = new Map(
        dataroomCounts.map((dc) => [dc.documentId, dc._count.id]),
      );

      // Combine documents with their counts
      const documentsWithCounts = documents.map((document) => ({
        ...document,
        _count: {
          links: linkCountMap.get(document.id) || 0,
          views: viewCountMap.get(document.id) || 0,
          versions: versionCountMap.get(document.id) || 0,
          datarooms: dataroomCountMap.get(document.id) || 0,
        },
      }));

      return res.status(200).json(documentsWithCounts);
    } catch (error) {
      console.error("Request error", error);
      return res.status(500).json({ error: "Error fetching folders" });
    }
  } else {
    // We only allow GET requests
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
