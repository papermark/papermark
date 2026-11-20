import { NextRequest, NextResponse } from "next/server";

import { getTeamStorageConfigById } from "@/ee/features/storage/config";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth/auth-options";

import {
  buildFolderNameMap,
  buildFolderPathsFromHierarchy,
} from "@/lib/dataroom/build-folder-hierarchy";
import prisma from "@/lib/prisma";
import { dataroomFreezeArchiveTask } from "@/ee/features/dataroom-freeze/lib/trigger/dataroom-freeze-archive";
import { CustomUser } from "@/lib/types";
import { generateTriggerPublicAccessToken } from "@/lib/utils/generate-trigger-auth-token";

export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: { teamId: string; id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { teamId, id: dataroomId } = params;
  const userId = (session.user as CustomUser).id;

  try {
    const teamAccess = await prisma.userTeam.findUnique({
      where: { userId_teamId: { userId, teamId } },
      select: {
        role: true,
        team: { select: { plan: true } },
      },
    });

    if (!teamAccess) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (teamAccess.role !== "ADMIN" && teamAccess.role !== "MANAGER") {
      return NextResponse.json(
        { message: "Only admins and managers can retry archive generation." },
        { status: 403 },
      );
    }

    const plan = teamAccess.team.plan;
    const hasDataroomsPlusPlan =
      plan.includes("datarooms-plus") ||
      plan.includes("datarooms-premium") ||
      plan.includes("datarooms-unlimited");

    if (!hasDataroomsPlusPlan) {
      return NextResponse.json(
        { message: "This feature requires a Data Rooms Plus plan or higher." },
        { status: 403 },
      );
    }

    const dataroom = await prisma.dataroom.findUnique({
      where: { id: dataroomId, teamId },
      select: {
        id: true,
        name: true,
        isFrozen: true,
        frozenAt: true,
        freezeArchiveUrl: true,
        folders: {
          select: { id: true, name: true, path: true, parentId: true },
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
      return NextResponse.json(
        { error: "Dataroom not found" },
        { status: 404 },
      );
    }

    if (!dataroom.isFrozen || !dataroom.frozenAt) {
      return NextResponse.json(
        { error: "Dataroom is not frozen" },
        { status: 400 },
      );
    }

    if (dataroom.freezeArchiveUrl) {
      return NextResponse.json(
        { error: "Archive already exists" },
        { status: 400 },
      );
    }

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
        const folderInfo = folderMap.get(path) || { name: "Root", id: null };
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

    const docsByFolderId = new Map<string, typeof dataroom.documents>();
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
    const tag = `freeze:${dataroomId}:${dataroom.frozenAt.getTime()}`;

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

    return NextResponse.json({
      runId: handle.id,
      publicAccessToken,
    });
  } catch (error) {
    console.error("Error retrying freeze archive:", error);
    return NextResponse.json(
      {
        message: "Internal Server Error",
        error: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
