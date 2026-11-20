import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { sortItemsByIndexAndName } from "@/lib/utils/sort-items-by-index-name";
import { folderPathSchema } from "@/lib/zod/schemas/folders";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/folder-documents/:name
    //
    // Returns the documents directly inside the folder at the given path.
    // Lives outside the `folders/` namespace because `folders/[...name]` is
    // a catch-all — a literal `folders/documents/<path>` URL would otherwise
    // be ambiguous (and Next.js would route it here instead of to the folder
    // listing endpoint, breaking any folder whose top-level segment slugifies
    // to "documents").
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const userId = (session.user as CustomUser).id;
    const {
      teamId,
      id: dataroomId,
      name,
    } = req.query as { teamId: string; id: string; name: string[] };

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
      // Scope the dataroom through the team membership check to avoid IDORs
      // where a valid team member supplies another team's dataroom id.
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

      const folder = await prisma.dataroomFolder.findUnique({
        where: {
          dataroomId_path: {
            dataroomId,
            path,
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

      const documents = await prisma.dataroomDocument.findMany({
        where: {
          dataroomId: dataroomId,
          folderId: folder.id,
        },
        orderBy: [
          { orderIndex: "asc" },
          {
            document: {
              name: "asc",
            },
          },
        ],
        select: {
          id: true,
          dataroomId: true,
          folderId: true,
          createdAt: true,
          updatedAt: true,
          orderIndex: true,
          hierarchicalIndex: true,
          document: {
            select: {
              id: true,
              name: true,
              type: true,
              advancedExcelEnabled: true,
              versions: {
                select: { id: true, hasPages: true },
              },
              isExternalUpload: true,
              _count: {
                select: {
                  views: { where: { dataroomId } },
                  versions: true,
                },
              },
            },
          },
        },
      });

      if (documents.length === 0) {
        return res.status(200).json([]);
      }

      const sortedDocuments = sortItemsByIndexAndName(documents);

      return res.status(200).json(sortedDocuments);
    } catch (error) {
      console.error("Request error", error);
      return res
        .status(500)
        .json({ error: "Error fetching dataroom folder documents" });
    }
  } else {
    // We only allow GET requests
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
