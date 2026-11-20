import { NextApiRequest, NextApiResponse } from "next";

import { Session } from "next-auth";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { supportsAdvancedExcelMode } from "@/lib/utils/get-content-type";

import { authOptions } from "../../auth/[...nextauth]";

interface CustomSession extends Session {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "PATCH") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const session = (await getServerSession(
      req,
      res,
      authOptions,
    )) as CustomSession | null;
    if (!session?.user?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { teamId } = req.query;
    const { enableExcelAdvancedMode } = req.body as {
      enableExcelAdvancedMode: boolean;
    };

    const team = await prisma.team.findFirst({
      where: {
        id: teamId as string,
        users: {
          some: {
            userId: session.user.id,
          },
        },
      },
    });

    if (!team) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Start a transaction to ensure all updates succeed or none do
    const result = await prisma.$transaction(async (tx) => {
      // Get all Excel documents in the team that need to be updated
      const documents = await tx.document.findMany({
        where: {
          teamId: teamId as string,
          type: "sheet",
          advancedExcelEnabled: !enableExcelAdvancedMode,
        },
        include: {
          versions: {
            where: {
              isPrimary: true,
              type: "sheet",
            },
            select: {
              id: true,
              file: true,
              storageType: true,
              contentType: true,
            },
          },
        },
      });

      const eligibleDocuments = documents.filter((doc) => {
        const primaryVersion = doc.versions[0];
        return (
          primaryVersion &&
          supportsAdvancedExcelMode(primaryVersion.contentType)
        );
      });

      // Update all documents and their versions
      const updatePromises = eligibleDocuments.map(async (doc) => {
        const primaryVersion = doc.versions[0];
        if (!primaryVersion) return;

        if (enableExcelAdvancedMode) {
          // Update document and version when enabling
          await Promise.all([
            tx.document.update({
              where: { id: doc.id },
              data: { advancedExcelEnabled: true },
            }),
            tx.documentVersion.update({
              where: { id: primaryVersion.id },
              data: { numPages: 1 },
            }),
          ]);
        } else {
          await tx.document.update({
            where: { id: doc.id },
            data: { advancedExcelEnabled: false },
          });
        }

        // Revalidate the document
        await fetch(
          `${process.env.NEXTAUTH_URL}/api/revalidate?secret=${process.env.REVALIDATE_TOKEN}&documentId=${doc.id}`,
        );
      });

      await Promise.all(updatePromises);
      const updatedTeam = await tx.team.update({
        where: {
          id: teamId as string,
        },
        data: {
          enableExcelAdvancedMode,
        },
      });
      return {
        team: updatedTeam,
        updatedDocumentsCount: eligibleDocuments.length,
      };
    });
    return res.status(200).json({
      ...result,
      message: `Successfully ${enableExcelAdvancedMode ? "enabled" : "disabled"} advanced Excel mode for ${result.updatedDocumentsCount} documents`,
    });
  } catch (error) {
    errorhandler(error, res);
  }
}
