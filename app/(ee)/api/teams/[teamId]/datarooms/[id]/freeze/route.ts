import { NextRequest, NextResponse } from "next/server";

import { getTeamStorageConfigById } from "@/ee/features/storage/config";
import { getServerSession } from "next-auth";

import { authOptions } from "@/pages/api/auth/[...nextauth]";

import {
  buildFolderNameMap,
  buildFolderPathsFromHierarchy,
} from "@/lib/dataroom/build-folder-hierarchy";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import { dataroomFreezeArchiveTask } from "@/ee/features/dataroom-freeze/lib/trigger/dataroom-freeze-archive";
import { CustomUser } from "@/lib/types";
import { generateTriggerPublicAccessToken } from "@/lib/utils/generate-trigger-auth-token";

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
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
      where: {
        userId_teamId: {
          userId,
          teamId,
        },
      },
      select: { role: true },
    });

    if (!teamAccess) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (teamAccess.role !== "ADMIN" && teamAccess.role !== "MANAGER") {
      return NextResponse.json(
        { message: "Only admins and managers can freeze data rooms." },
        { status: 403 },
      );
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
      return NextResponse.json(
        { error: "Dataroom not found" },
        { status: 404 },
      );
    }

    if (dataroom.isFrozen) {
      return NextResponse.json(
        { error: "Dataroom is already frozen" },
        { status: 400 },
      );
    }

    const { token } = (await request.json()) as { token?: string };
    if (!token || token.length !== 6) {
      return NextResponse.json(
        { error: "A valid 6-digit verification code is required." },
        { status: 400 },
      );
    }

    const { success: rlSuccess } = await ratelimit(5, "1 m").limit(
      `verify-freeze-otp:${userId}`,
    );
    if (!rlSuccess) {
      return NextResponse.json(
        { message: "Too many attempts. Please try again later." },
        { status: 429 },
      );
    }

    const verification = await prisma.verificationToken.findUnique({
      where: {
        token,
        identifier: `freeze-otp:${dataroomId}:${userId}`,
      },
    });

    if (!verification) {
      return NextResponse.json(
        { error: "Invalid verification code. Please try again." },
        { status: 401 },
      );
    }

    if (Date.now() > verification.expires.getTime()) {
      await prisma.verificationToken.delete({ where: { token } });
      return NextResponse.json(
        { error: "Verification code expired. Please request a new one." },
        { status: 401 },
      );
    }

    await prisma.verificationToken.delete({ where: { token } });

    const frozenAt = new Date();
    await prisma.$transaction([
      prisma.dataroom.update({
        where: { id: dataroomId },
        data: {
          isFrozen: true,
          frozenAt,
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
    const tag = `freeze:${dataroomId}:${frozenAt.getTime()}`;

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
    console.error("Error freezing dataroom:", error);
    return NextResponse.json(
      {
        message: "Internal Server Error",
        error: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
