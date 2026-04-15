import { NextApiRequest, NextApiResponse } from "next";

import { getServerSession } from "next-auth/next";

import { getFile } from "@/lib/files/get-file";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";

import { authOptions } from "../../../../auth/[...nextauth]";

const MAX_PAGES_PER_REQUEST = 50;

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

  const { pageNumbers } = req.body as { pageNumbers: number[] };

  if (!pageNumbers || pageNumbers.length === 0) {
    return res.status(400).json({ message: "pageNumbers is required" });
  }

  if (pageNumbers.length > MAX_PAGES_PER_REQUEST) {
    return res.status(400).json({
      message: `Cannot request more than ${MAX_PAGES_PER_REQUEST} pages at once.`,
    });
  }

  try {
    const team = await prisma.team.findUnique({
      where: {
        id: teamId,
        users: {
          some: { userId },
        },
      },
    });

    if (!team) {
      return res.status(403).json({ message: "Access denied" });
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        teamId: true,
        versions: {
          where: { isPrimary: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!document || document.teamId !== teamId) {
      return res.status(403).json({ message: "Access denied" });
    }

    const primaryVersion = document.versions[0];
    if (!primaryVersion) {
      return res.status(404).json({ message: "Document version not found" });
    }

    const documentPages = await prisma.documentPage.findMany({
      where: {
        versionId: primaryVersion.id,
        pageNumber: { in: pageNumbers },
      },
      select: {
        file: true,
        storageType: true,
        pageNumber: true,
      },
    });

    const pagesWithUrls = await Promise.all(
      documentPages.map(async (page) => {
        const { storageType, ...otherPage } = page;
        return {
          pageNumber: otherPage.pageNumber,
          file: await getFile({ data: page.file, type: storageType }),
        };
      }),
    );

    return res.status(200).json({ pages: pagesWithUrls });
  } catch (error) {
    log({
      message: "Error fetching preview page URLs",
      type: "error",
      mention: true,
    });
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
