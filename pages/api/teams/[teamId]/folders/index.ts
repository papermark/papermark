import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { resolveFreeFolderPath } from "@/lib/folders/bulk-create";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/folders
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const userId = (session.user as CustomUser).id;
    const { teamId, root } = req.query as { teamId: string; root?: string };

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

      /** if root is present then only get root folders */
      if (root === "true") {
        const folders = await prisma.folder.findMany({
          where: {
            teamId: teamId,
            parentId: null,
            hiddenInAllDocuments: false, // Exclude hidden folders from All Documents view
          },
          orderBy: {
            name: "asc",
          },
          include: {
            _count: {
              select: {
                documents: {
                  where: { hiddenInAllDocuments: false },
                },
                childFolders: {
                  where: { hiddenInAllDocuments: false },
                },
              },
            },
          },
        });

        return res.status(200).json(folders);
      }

      const folders = await prisma.folder.findMany({
        where: {
          teamId: teamId,
        },
        orderBy: {
          name: "asc",
        },
        include: {
          documents: {
            select: {
              id: true,
              name: true,
              folderId: true,
            },
          },
          childFolders: {
            include: {
              documents: {
                select: {
                  id: true,
                  name: true,
                  folderId: true,
                },
              },
            },
          },
        },
      });

      return res.status(200).json(folders);
    } catch (error) {
      console.error("Request error", error);
      return res.status(500).json({ error: "Error fetching folders" });
    }
  } else if (req.method === "POST") {
    // POST /api/teams/:teamId/folders
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const userId = (session.user as CustomUser).id;

    const { teamId } = req.query as { teamId: string };
    const { name, path, icon, color } = req.body as {
      name: string;
      path: string;
      icon?: string;
      color?: string;
    };

    const parentFolderPath = path ? "/" + path : "/";

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

      const parentFolder = await prisma.folder.findUnique({
        where: {
          teamId_path: {
            teamId: teamId,
            path: parentFolderPath,
          },
        },
        select: {
          id: true,
          name: true,
          path: true,
        },
      });

      const resolved = await resolveFreeFolderPath({
        name,
        parentPath: parentFolderPath,
        findExisting: (candidates) =>
          prisma.folder.findMany({
            where: { teamId, path: { in: candidates } },
            select: { path: true },
          }),
      }).catch((err) => {
        if (err?.code === "SLUG_EXHAUSTED") return null;
        throw err;
      });
      if (!resolved) {
        return res.status(400).json({
          error: "Failed to create folder",
          message: "Too many folders with similar names",
        });
      }

      const folder = await prisma.folder.create({
        data: {
          name: resolved.name,
          path: resolved.path,
          parentId: parentFolder?.id ?? null,
          teamId: teamId,
          icon: icon ?? null,
          color: color ?? null,
        },
      });

      const folderWithDocs = {
        ...folder,
        documents: [],
        childFolders: [],
        parentFolderPath: parentFolderPath,
      };

      res.status(201).json(folderWithDocs);
    } catch (error) {
      console.error("Request error", error);
      res.status(500).json({ error: "Error creating folder" });
    }
  } else {
    // We only allow POST requests
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
