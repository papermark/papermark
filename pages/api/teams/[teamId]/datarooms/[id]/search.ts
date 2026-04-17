import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

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
  const {
    teamId,
    id: dataroomId,
    query,
  } = req.query as {
    teamId: string;
    id: string;
    query?: string;
  };

  if (!query || query.trim().length === 0) {
    return res.status(200).json({ documents: [], folders: [] });
  }

  try {
    const teamAccess = await prisma.userTeam.findUnique({
      where: {
        userId_teamId: {
          userId,
          teamId,
        },
      },
    });

    if (!teamAccess) {
      return res.status(401).end("Unauthorized");
    }

    const dataroom = await prisma.dataroom.findUnique({
      where: {
        id: dataroomId,
        teamId,
      },
      select: { id: true },
    });

    if (!dataroom) {
      return res.status(404).json({
        error: "Not Found",
        message: "The requested dataroom does not exist",
      });
    }

    const [documents, folders] = await Promise.all([
      prisma.dataroomDocument.findMany({
        where: {
          dataroomId,
          document: {
            name: {
              contains: query.trim(),
              mode: "insensitive",
            },
          },
        },
        orderBy: [
          { orderIndex: "asc" },
          { document: { name: "asc" } },
        ],
        select: {
          id: true,
          dataroomId: true,
          folderId: true,
          orderIndex: true,
          hierarchicalIndex: true,
          createdAt: true,
          updatedAt: true,
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
      }),

      prisma.dataroomFolder.findMany({
        where: {
          dataroomId,
          name: {
            contains: query.trim(),
            mode: "insensitive",
          },
        },
        orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          path: true,
          parentId: true,
          dataroomId: true,
          orderIndex: true,
          hierarchicalIndex: true,
          icon: true,
          color: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { documents: true, childFolders: true },
          },
        },
      }),
    ]);

    // Build breadcrumb paths for documents that are in folders
    const folderIds = [
      ...new Set(documents.filter((d) => d.folderId).map((d) => d.folderId!)),
    ];

    const allFoldersInDataroom =
      folderIds.length > 0
        ? await prisma.dataroomFolder.findMany({
            where: { dataroomId },
            select: { id: true, name: true, path: true, parentId: true },
          })
        : [];

    const folderMap = new Map(
      allFoldersInDataroom.map((f) => [f.id, f]),
    );

    const buildBreadcrumb = (folderId: string): string[] => {
      const names: string[] = [];
      let currentId: string | null = folderId;
      while (currentId) {
        const folder = folderMap.get(currentId);
        if (!folder) break;
        names.unshift(folder.name);
        currentId = folder.parentId;
      }
      return names;
    };

    const documentsWithPath = documents.map((doc) => ({
      ...doc,
      folderPath: doc.folderId ? buildBreadcrumb(doc.folderId) : [],
    }));

    const foldersWithPath = folders.map((folder) => ({
      ...folder,
      folderPath: folder.parentId ? buildBreadcrumb(folder.parentId) : [],
    }));

    return res.status(200).json({
      documents: documentsWithPath,
      folders: foldersWithPath,
    });
  } catch (error) {
    console.error("Request error", error);
    return res
      .status(500)
      .json({ error: "Error searching dataroom" });
  }
}
