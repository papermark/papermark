import { NextApiRequest, NextApiResponse } from "next";

import { getTeamStorageConfigById } from "@/ee/features/storage/config";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth";

import {
  buildFolderNameMap,
  buildFolderPathsFromHierarchy,
} from "@/lib/dataroom/build-folder-hierarchy";
import prisma from "@/lib/prisma";
import { dataroomFreezeArchiveTask } from "@/lib/trigger/dataroom-freeze-archive";
import { CustomUser } from "@/lib/types";
import { generateTriggerPublicAccessToken } from "@/lib/utils/generate-trigger-auth-token";

export const config = {
  maxDuration: 60,
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const { teamId, id: dataroomId } = req.query as {
    teamId: string;
    id: string;
  };

  const userId = (session.user as CustomUser).id;

  try {
    const teamAccess = await prisma.userTeam.findUnique({
      where: {
        userId_teamId: {
          userId,
          teamId,
        },
      },
      select: { role: true },
    });

    if (!teamAccess) {
      return res.status(401).end("Unauthorized");
    }

    if (teamAccess.role !== "ADMIN" && teamAccess.role !== "MANAGER") {
      return res.status(403).json({
        message:
          "Only admins and managers can freeze data rooms.",
      });
    }

    const dataroom = await prisma.dataroom.findUnique({
      where: {
        id: dataroomId,
        teamId,
      },
      select: {
        id: true,
        name: true,
        isFrozen: true,
        folders: {
          select: {
            id: true,
            name: true,
            path: true,
            parentId: true,
          },
        },
        documents: {
          select: {
            id: true,
            folderId: true,
            document: {
              select: {
                name: true,
                versions: {
                  where: { isPrimary: true },
                  select: {
                    type: true,
                    file: true,
                    storageType: true,
                    originalFile: true,
                    contentType: true,
                    fileSize: true,
                  },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!dataroom) {
      return res.status(404).json({ error: "Dataroom not found" });
    }

    if (dataroom.isFrozen) {
      return res.status(400).json({ error: "Dataroom is already frozen" });
    }

    // Freeze the dataroom and archive all links in a transaction
    await prisma.$transaction([
      prisma.dataroom.update({
        where: { id: dataroomId },
        data: {
          isFrozen: true,
          frozenAt: new Date(),
          frozenBy: userId,
        },
      }),
      prisma.link.updateMany({
        where: {
          dataroomId,
          isArchived: false,
        },
        data: {
          isArchived: true,
        },
      }),
    ]);

    // Build folder structure for the archive (same pattern as bulk download)
    const computedPathMap = buildFolderPathsFromHierarchy(dataroom.folders);
    const folderMap = buildFolderNameMap(dataroom.folders, computedPathMap);

    const folderStructure: {
      [key: string]: {
        name: string;
        path: string;
        files: { name: string; key: string; size?: number }[];
      };
    } = {};
    const fileKeys: string[] = [];

    const addFileToStructure = (
      path: string,
      fileName: string,
      fileKey: string,
      fileSize?: number,
    ) => {
      const pathParts = path.split("/").filter(Boolean);
      let currentPath = "";

      pathParts.forEach((part) => {
        currentPath += "/" + part;
        const folderInfo = folderMap.get(currentPath);
        if (!folderStructure[currentPath]) {
          folderStructure[currentPath] = {
            name: folderInfo ? folderInfo.name : part,
            path: currentPath,
            files: [],
          };
        }
      });

      if (!folderStructure[path]) {
        const folderInfo = folderMap.get(path) || {
          name: "Root",
          id: null,
        };
        folderStructure[path] = {
          name: folderInfo.name,
          path: path,
          files: [],
        };
      }
      folderStructure[path].files.push({
        name: fileName,
        key: fileKey,
        size: fileSize,
      });
      fileKeys.push(fileKey);
    };

    // Root-level documents
    dataroom.documents
      .filter((doc) => !doc.folderId)
      .filter((doc) => doc.document.versions[0]?.type !== "notion")
      .filter((doc) => doc.document.versions[0]?.storageType !== "VERCEL_BLOB")
      .forEach((doc) =>
        addFileToStructure(
          "/",
          doc.document.name,
          doc.document.versions[0].originalFile ??
            doc.document.versions[0].file,
          doc.document.versions[0].fileSize
            ? Number(doc.document.versions[0].fileSize)
            : undefined,
        ),
      );

    // Pre-index documents by folderId
    const docsByFolderId = new Map<
      string,
      typeof dataroom.documents
    >();
    for (const doc of dataroom.documents) {
      if (!doc.folderId) continue;
      const list = docsByFolderId.get(doc.folderId) ?? [];
      list.push(doc);
      docsByFolderId.set(doc.folderId, list);
    }

    dataroom.folders.forEach((folder) => {
      const folderPath = computedPathMap.get(folder.id) ?? folder.path;
      const folderDocs = (docsByFolderId.get(folder.id) ?? [])
        .filter((doc) => doc.document.versions[0]?.type !== "notion")
        .filter(
          (doc) => doc.document.versions[0]?.storageType !== "VERCEL_BLOB",
        );

      folderDocs.forEach((doc) =>
        addFileToStructure(
          folderPath,
          doc.document.name,
          doc.document.versions[0].originalFile ??
            doc.document.versions[0].file,
          doc.document.versions[0].fileSize
            ? Number(doc.document.versions[0].fileSize)
            : undefined,
        ),
      );

      if (folderDocs.length === 0) {
        addFileToStructure(folderPath, "", "");
      }
    });

    const storageConfig = await getTeamStorageConfigById(teamId);
    const tag = `freeze:${dataroomId}`;

    const handle = await dataroomFreezeArchiveTask.trigger(
      {
        dataroomId: dataroom.id,
        dataroomName: dataroom.name,
        teamId,
        userId,
        folderStructure,
        fileKeys: fileKeys.filter(Boolean),
        sourceBucket: storageConfig.bucket,
      },
      {
        tags: [tag, `team_${teamId}`, `dataroom_${dataroomId}`],
      },
    );

    const publicAccessToken = await generateTriggerPublicAccessToken(tag);

    return res.status(200).json({
      runId: handle.id,
      publicAccessToken,
    });
  } catch (error) {
    console.error("Error freezing dataroom:", error);
    return res.status(500).json({
      message: "Internal Server Error",
      error: (error as Error).message,
    });
  }
}
