import { NextApiRequest, NextApiResponse } from "next";

import { getLimits } from "@/ee/limits/server";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth/next";

import { enforceDataroomMemberScope } from "@/lib/api/rbac/guard";
import { isDataroomScopedRole } from "@/lib/api/rbac/permissions";
import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { serializeFileSize } from "@/lib/utils";

/**
 * Dataroom-scoped document overview.
 *
 * Mirrors `/documents/:id/overview` but is addressed by the DataroomDocument id
 * and gated by `enforceDataroomMemberScope`, so a dataroom-scoped member can
 * load a document's analytics from inside a room they are assigned to without
 * being granted access to the team-wide `/documents/:id` surface.
 *
 * `documentId` in the route is the DataroomDocument id; the resolved underlying
 * Document id is returned as `documentId` so the client can drive the existing
 * (already scope-guarded) document endpoints for links/stats/views.
 */
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

  const {
    teamId,
    id: dataroomId,
    documentId: dataroomDocumentId,
  } = req.query as {
    teamId: string;
    id: string;
    documentId: string;
  };

  const userId = (session.user as CustomUser).id;

  const membership = await prisma.userTeam.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { role: true },
  });

  // Scoped members may only read documents within their assigned rooms.
  if (
    await enforceDataroomMemberScope({
      userId,
      teamId,
      dataroomId,
      res,
      role: membership?.role,
    })
  ) {
    return;
  }

  const isScopedMember = isDataroomScopedRole(membership?.role ?? "");

  try {
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

    // Resolve the DataroomDocument → underlying Document, ensuring the document
    // actually lives in this room (closes cross-room access).
    const dataroomDocument = await prisma.dataroomDocument.findUnique({
      where: {
        id: dataroomDocumentId,
        dataroomId,
      },
      select: {
        id: true,
        dataroomId: true,
        folder: {
          select: {
            id: true,
            name: true,
            path: true,
          },
        },
        dataroom: {
          select: {
            id: true,
            name: true,
          },
        },
        document: {
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
            _count: {
              select: {
                links: true,
                views: { where: { isArchived: false } },
              },
            },
          },
        },
      },
    });

    if (
      !dataroomDocument ||
      dataroomDocument.document.teamId !== teamId ||
      !dataroomDocument.document.versions ||
      dataroomDocument.document.versions.length === 0
    ) {
      return res.status(404).json({
        error: "Not Found",
        message: "The requested document does not exist in this data room",
      });
    }

    const document = dataroomDocument.document;

    const [limits, featureFlags] = await Promise.all([
      getLimits({ teamId, userId }),
      getFeatureFlags({ teamId }),
    ]);

    const primaryVersion = document.versions[0];
    const hasLinks = document._count.links > 0;
    const hasViews = document._count.views > 0;

    // Direct document-link visits (no data room). Surfaced as a small count so
    // full team members know the document has activity outside this room. Never
    // exposed to dataroom-scoped members.
    const otherViewCount = isScopedMember
      ? 0
      : await prisma.view.count({
          where: {
            documentId: document.id,
            dataroomId: null,
            isArchived: false,
          },
        });

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

    const response = {
      dataroomDocumentId: dataroomDocument.id,
      documentId: document.id,
      dataroom: dataroomDocument.dataroom,
      dataroomFolder: dataroomDocument.folder,
      document: {
        ...serializeFileSize(document),
        primaryVersion: serializeFileSize(primaryVersion),
        hasPageLinks,
        isEmpty: !hasLinks && !hasViews,
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
        otherViewCount,
      },
    };

    res.setHeader(
      "Cache-Control",
      "private, max-age=60, stale-while-revalidate=300",
    );

    return res.status(200).json(response);
  } catch (error) {
    console.error("Dataroom document overview error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
