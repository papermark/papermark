import { NextApiRequest, NextApiResponse } from "next";

import { getLimits } from "@/ee/limits/server";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth/next";

import { enforceDocumentMemberScope } from "@/lib/api/rbac/guard";
import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { serializeFileSize } from "@/lib/utils";

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

  const { teamId, id: docId } = req.query as {
    teamId: string;
    id: string;
  };

  const userId = (session.user as CustomUser).id;

  // Dataroom-scoped members may only access documents in their assigned rooms.
  if (
    await enforceDocumentMemberScope({ userId, teamId, documentId: docId, res })
  ) {
    return;
  }

  try {
    // First verify user has access to the team
    const team = await prisma.team.findUnique({
      where: {
        id: teamId,
        users: {
          some: {
            userId,
          },
        },
      },
      select: { plan: true },
    });

    if (!team) {
      return res.status(401).end("Unauthorized");
    }

    // Parallel fetch of core data
    const [document, limits, featureFlags] = await Promise.all([
      prisma.document.findUnique({
        where: {
          id: docId,
          teamId,
        },
        select: {
          id: true,
          name: true,
          description: true,
          file: true,
          originalFile: true,
          type: true,
          contentType: true,
          storageType: true,
          numPages: true,
          ownerId: true,
          teamId: true,
          agentsEnabled: true,
          advancedExcelEnabled: true,
          downloadOnly: true,
          createdAt: true,
          updatedAt: true,
          folderId: true,
          isExternalUpload: true,
          versions: {
            where: { isPrimary: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          folder: {
            select: {
              name: true,
              path: true,
            },
          },
          datarooms: {
            select: {
              dataroom: {
                select: {
                  id: true,
                  name: true,
                },
              },
              folder: {
                select: {
                  id: true,
                  name: true,
                  path: true,
                },
              },
            },
          },
          // Get counts without fetching full records
          _count: {
            select: {
              links: true,
              views: { where: { isArchived: false } },
            },
          },
        },
      }),
      getLimits({ teamId, userId }),
      getFeatureFlags({ teamId }),
    ]);

    if (!document || !document.versions || document.versions.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "The requested document does not exist",
      });
    }

    const primaryVersion = document.versions[0];
    const hasLinks = document._count.links > 0;
    const hasViews = document._count.views > 0;

    // Check for page links only if needed
    let hasPageLinks = false;
    if (primaryVersion && team.plan.includes("free")) {
      const pageLinksCount = await prisma.documentPage.count({
        where: {
          versionId: primaryVersion.id,
          pageLinks: {
            not: Prisma.JsonNull,
          },
        },
      });
      hasPageLinks = pageLinksCount > 0;
    }

    // Basic response for instant loading
    const response = {
      document: {
        ...serializeFileSize(document),
        primaryVersion: serializeFileSize(primaryVersion),
        hasPageLinks,
        isEmpty: !hasLinks && !hasViews, // Flag for empty state optimization
      },
      limits: {
        canAddLinks: limits?.links ? limits?.usage?.links < limits.links : true,
        canAddDocuments: limits?.documents
          ? limits?.usage?.documents < limits.documents
          : true,
        canAddUsers: limits?.users ? limits?.usage?.users < limits.users : true,
      },
      featureFlags: {
        annotations: featureFlags.annotations,
      },
      team: {
        plan: team?.plan || "free",
        isTrial: team?.plan.includes("drtrial") || false,
      },
      counts: {
        links: document._count.links,
        views: document._count.views,
      },
    };

    // Always revalidate with the server since document metadata is mutable
    res.setHeader("Cache-Control", "private, no-cache, must-revalidate");

    return res.status(200).json(response);
  } catch (error) {
    console.error("Document overview error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
