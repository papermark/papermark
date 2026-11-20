import { NextApiRequest, NextApiResponse } from "next";

import { getServerSession } from "next-auth/next";

import { enforceDocumentMemberScope } from "@/lib/api/rbac/guard";
import { getFile } from "@/lib/files/get-file";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { buildAttachmentDispositionForName, log } from "@/lib/utils";
import { ensureFileExtension } from "@/lib/utils/get-content-type";

import { authOptions } from "../../../../auth/[...nextauth]";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { id: documentId, teamId } = req.query as {
    id: string;
    teamId: string;
  };
  const userId = (session.user as CustomUser).id;

  // Dataroom-scoped members may only download documents in their assigned rooms.
  if (await enforceDocumentMemberScope({ userId, teamId, documentId, res })) {
    return;
  }

  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId, teamId },
      select: {
        name: true,
        team: {
          select: {
            users: {
              where: { userId },
              select: { userId: true },
            },
          },
        },
        versions: {
          where: { isPrimary: true },
          select: {
            type: true,
            file: true,
            originalFile: true,
            storageType: true,
            contentType: true,
          },
          take: 1,
        },
      },
    });

    if (!document || document.team.users.length === 0) {
      return res.status(403).json({ message: "Access denied" });
    }

    const version = document.versions[0];
    if (!version) {
      return res.status(404).json({ message: "Document version not found" });
    }

    if (version.type === "notion") {
      return res
        .status(400)
        .json({ message: "Notion documents cannot be downloaded." });
    }

    const desiredFileName = ensureFileExtension({
      name: document.name,
      contentType: version.contentType,
      type: version.type,
    });

    const downloadUrl = await getFile({
      type: version.storageType,
      data: version.originalFile ?? version.file,
      isDownload: true,
      responseContentDisposition: desiredFileName
        ? buildAttachmentDispositionForName(desiredFileName)
        : undefined,
    });

    return res.status(200).json({ downloadUrl, fileName: desiredFileName });
  } catch (error) {
    log({
      message: "Error preparing task upload download",
      type: "error",
      mention: true,
    });
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
