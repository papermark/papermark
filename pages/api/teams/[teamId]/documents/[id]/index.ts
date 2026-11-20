import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { assertDocumentAccess } from "@/lib/api/rbac/entitlements";
import { isDataroomScopedRole } from "@/lib/api/rbac/permissions";
import { TeamError, errorhandler } from "@/lib/errorHandler";
import { getFeatureFlags } from "@/lib/featureFlags";
import { deleteFile } from "@/lib/files/delete-file-server";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import { CustomUser } from "@/lib/types";
import { serializeFileSize } from "@/lib/utils";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/documents/:id
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { teamId, id: docId } = req.query as { teamId: string; id: string };

    const userId = (session.user as CustomUser).id;

    try {
      // Per-user, per-document rate limit to prevent abuse
      // Default: 120 requests per minute per user per document
      const { success, limit, remaining, reset } = await ratelimit(
        120,
        "1 m",
      ).limit(`doc:${docId}:team:${teamId}:user:${userId}`);

      res.setHeader("X-RateLimit-Limit", limit.toString());
      res.setHeader("X-RateLimit-Remaining", remaining.toString());
      res.setHeader("X-RateLimit-Reset", reset.toString());
      if (!success) {
        return res.status(429).json({ error: "Too many requests" });
      }

      // First verify user has access to the team (lightweight query)
      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: userId,
            teamId: teamId,
          },
        },
        select: { teamId: true, role: true },
      });

      if (!teamAccess) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Dataroom-scoped members may only read a document that lives in one of
      // their assigned rooms (closes cross-room/all-documents IDOR).
      const hasDocumentAccess = await assertDocumentAccess({
        role: teamAccess.role,
        userId,
        teamId,
        documentId: docId,
      });
      if (!hasDocumentAccess) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // Then fetch the specific document with its relationships (targeted query)
      const document = await prisma.document.findUnique({
        where: {
          id: docId,
          teamId,
        },
        include: {
          // Get the latest primary version of the document
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
        },
      });

      if (!document || !document.versions || document.versions.length === 0) {
        return res.status(404).json({
          error: "Not Found",
          message: "The requested document does not exist",
        });
      }

      const pages = await prisma.documentPage.findMany({
        where: {
          versionId: document.versions[0].id,
        },
        select: {
          pageLinks: true,
        },
      });

      const hasPageLinks = pages.some(
        (page) =>
          page.pageLinks &&
          Array.isArray(page.pageLinks) &&
          (page.pageLinks as any[]).length > 0,
      );

      // Check that the user is owner of the document, otherwise return 401
      // if (document.ownerId !== (session.user as CustomUser).id) {
      //   return res.status(401).end("Unauthorized to access this document");
      // }

      return res
        .status(200)
        .json(serializeFileSize({ ...document, hasPageLinks }));
    } catch (error) {
      if (error instanceof TeamError) {
        return res.status(404).json({
          error: "Not Found",
          message: error.message,
        });
      }
      errorhandler(error, res);
    }
  } else if (req.method === "PUT") {
    // PUT /api/teams/:teamId/document/:id
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = (session.user as CustomUser).id;
    const { teamId, id: docId } = req.query as { teamId: string; id: string };
    const { folderId, currentPathName } = req.body as {
      folderId: string;
      currentPathName: string;
    };

    const document = await prisma.document.update({
      where: {
        id: docId,
        teamId: teamId,
        team: {
          users: {
            some: {
              role: "ADMIN",
              userId: userId,
            },
          },
        },
      },
      data: {
        folderId: folderId,
      },
      select: {
        folder: {
          select: {
            path: true,
          },
        },
      },
    });

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    return res.status(200).json({
      message: "Document moved successfully",
      newPath: document.folder?.path,
      oldPath: currentPathName,
    });
  } else if (req.method === "PATCH") {
    // PATCH /api/teams/:teamId/documents/:id
    // Update document settings (e.g., agentsEnabled)
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { teamId, id: docId } = req.query as { teamId: string; id: string };
    const userId = (session.user as CustomUser).id;

    try {
      // Verify user has access to the team
      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: userId,
            teamId: teamId,
          },
        },
        select: { role: true },
      });

      if (!teamAccess) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Extract allowed fields from request body
      const { agentsEnabled } = req.body as {
        agentsEnabled?: boolean;
      };

      if (agentsEnabled !== undefined) {
        const features = await getFeatureFlags({ teamId });
        if (!features.ai) {
          return res
            .status(403)
            .json({ message: "AI feature is not available" });
        }
      }

      // Build update data object with only provided fields
      const updateData: { agentsEnabled?: boolean } = {};

      if (typeof agentsEnabled === "boolean") {
        updateData.agentsEnabled = agentsEnabled;
      }

      // Check if there's anything to update
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      // Update the document
      const document = await prisma.document.update({
        where: {
          id: docId,
          teamId: teamId,
        },
        data: updateData,
        select: {
          id: true,
          agentsEnabled: true,
        },
      });

      return res.status(200).json(document);
    } catch (error) {
      errorhandler(error, res);
    }
  } else if (req.method === "DELETE") {
    // DELETE /api/teams/:teamId/document/:id
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { teamId, id: docId } = req.query as { teamId: string; id: string };

    const userId = (session.user as CustomUser).id;

    try {
      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: userId,
            teamId: teamId,
          },
        },
        select: {
          role: true,
        },
      });
      if (!teamAccess) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Data room members can only remove documents from a data room (via the
      // dataroom-scoped endpoint); they must never delete the underlying
      // document for the whole team.
      if (isDataroomScopedRole(teamAccess.role)) {
        return res.status(403).json({
          message:
            "Data room members cannot delete documents. You can only remove documents from a data room.",
        });
      }

      const documentVersions = await prisma.document.findUnique({
        where: {
          id: docId,
          teamId: teamId,
        },
        include: {
          versions: {
            select: {
              id: true,
              file: true,
              type: true,
              storageType: true,
            },
          },
        },
      });

      if (!documentVersions) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Notion and web-link documents don't store any bytes: their `file` holds
      // an external URL, not a storage object. Skip storage deletion for them
      // (calling deleteFile on the URL would throw and abort the delete).
      if (
        documentVersions.type !== "notion" &&
        documentVersions.type !== "link"
      ) {
        // delete the files from storage
        for (const version of documentVersions.versions) {
          await deleteFile({
            type: version.storageType,
            data: version.file,
            teamId,
          });
        }
      }

      // delete the document from database
      await prisma.document.delete({
        where: {
          id: docId,
        },
      });

      return res.status(204).end(); // 204 No Content response for successful deletes
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    // We only allow GET, PUT, PATCH and DELETE requests
    res.setHeader("Allow", ["GET", "PUT", "PATCH", "DELETE"]);
    return res
      .status(405)
      .json({ message: `Method ${req.method} Not Allowed` });
  }
}
