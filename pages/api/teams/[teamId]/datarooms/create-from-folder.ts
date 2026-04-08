import { NextApiRequest, NextApiResponse } from "next";

import { getLimits } from "@/ee/limits/server";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { DataroomFolder, Document, Folder } from "@prisma/client";
import { getServerSession } from "next-auth/next";

import { newId } from "@/lib/id-helper";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

// Define types
interface FolderWithContents extends Folder {
  documents: Omit<Document, "folderId">[];
  childFolders: Omit<FolderWithContents, "parentId">[];
}

// Recursive function to fetch all folders, child folders, and documents
async function fetchFolderContents(
  folderId: string,
): Promise<FolderWithContents> {
  const folder = await prisma.folder.findUnique({
    where: {
      id: folderId,
    },
    include: {
      documents: true,
      childFolders: true,
    },
  });

  if (!folder) {
    throw new Error(`Folder with id ${folderId} not found`);
  }

  const childFolders = await Promise.all(
    folder.childFolders.map(async (childFolder) => {
      const nestedChildFolders = await fetchFolderContents(childFolder.id);
      return nestedChildFolders;
    }),
  );

  // Remove parentId from top-level child folders and folderId from top-level documents
  const modifiedDocuments = folder.documents.map((doc) => {
    return {
      ...doc,
      folderId: null,
    };
  });

  const modifiedChildFolders = childFolders.map((childFolder) => {
    return {
      ...childFolder,
      parentId: null,
      childFolders: childFolder.childFolders,
      documents: childFolder.documents,
    };
  });

  return {
    ...folder,
    documents: modifiedDocuments,
    childFolders: modifiedChildFolders,
  };
}

// Recursive function to create data room folders and documents
async function createDataroomFolders(
  dataroomId: string,
  folder: Omit<FolderWithContents, "parentId">,
  originalBasePath: string,
  parentFolderId?: string,
) {
  let dataroomFolder: DataroomFolder | undefined = undefined;
  if (originalBasePath !== folder.path) {
    // Skip the root folder

    dataroomFolder = await prisma.dataroomFolder.create({
      data: {
        name: folder.name,
        path: folder.path.replace(originalBasePath, ""),
        parentId: parentFolderId,
        dataroomId: dataroomId,
      },
    });

    // Create documents for the current folder
    await Promise.allSettled(
      folder.documents.map((doc) => {
        return prisma.dataroomDocument.create({
          data: {
            documentId: doc.id,
            dataroomId: dataroomId,
            folderId: dataroomFolder?.id,
          },
        });
      }),
    );
  }

  // Create child folders recursively
  await Promise.allSettled(
    folder.childFolders.map((childFolder) =>
      createDataroomFolders(
        dataroomId,
        childFolder,
        originalBasePath,
        dataroomFolder?.id,
      ),
    ),
  );
}

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    // POST /api/teams/:teamId/datarooms/create-from-folder
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const { teamId } = req.query as { teamId: string };
    const { folderId } = req.body as { folderId: string };
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
          plan: true,
          _count: {
            select: {
              datarooms: true,
            },
          },
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      const limits = await getLimits({ teamId, userId });
      const stripedTeamPlan = team.plan.replace("+old", "");

      if (
        !team.plan.includes("drtrial") &&
        ["business", "datarooms", "datarooms-plus", "datarooms-premium", "datarooms-unlimited"].includes(stripedTeamPlan) &&
        limits &&
        limits.datarooms !== null &&
        team._count.datarooms >= limits.datarooms
      ) {
        return res.status(403).json({
          message:
            "You've reached the limit of datarooms. Consider upgrading your plan.",
        });
      }

      if (team.plan.includes("drtrial") && team._count.datarooms > 0) {
        return res
          .status(400)
          .json({ message: "Trial data room already exists" });
      }

      if (["free", "pro"].includes(team.plan) && !team.plan.includes("drtrial")) {
        return res
          .status(400)
          .json({ message: "You need a Business plan to create a data room" });
      }

      // Fetch the folder structure
      const folderContents = await fetchFolderContents(folderId);

      // Create the data room
      const pId = newId("dataroom");
      const dataroom = await prisma.dataroom.create({
        data: {
          pId: pId,
          name: folderContents.name,
          teamId: teamId,
          documents: {
            create: folderContents.documents.map((doc) => ({
              documentId: doc.id,
            })),
          },
          folders: {
            create: [],
          },
        },
        select: { id: true },
      });

      // Start the recursive creation with the root folder
      await createDataroomFolders(
        dataroom.id,
        folderContents,
        folderContents.path,
      );

      const dataroomWithCount = await prisma.dataroom.findUnique({
        where: {
          id: dataroom.id,
        },
        include: {
          _count: { select: { documents: true } },
        },
      });

      res.status(201).json(dataroomWithCount);
    } catch (error) {
      console.error("Request error", error);
      res.status(500).json({ error: "Error creating dataroom" });
    }
  } else {
    // We only allow POST requests
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
