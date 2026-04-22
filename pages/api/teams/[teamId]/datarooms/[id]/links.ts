import { NextApiRequest, NextApiResponse } from "next";

import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser, LinkWithViews } from "@/lib/types";
import { decryptEncrpytedPassword, log } from "@/lib/utils";

import { authOptions } from "../../../../auth/[...nextauth]";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/links
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
      // Check if the user is part of the team
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: userId,
            },
          },
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      const links = await prisma.link.findMany({
        where: {
          dataroomId,
          linkType: "DATAROOM_LINK",
          teamId: teamId,
          deletedAt: null, // exclude deleted links
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          views: {
            where: {
              viewType: "DATAROOM_VIEW",
            },
            orderBy: {
              viewedAt: "desc",
            },
            take: 1,
          },
          customFields: true,
          visitorGroups: {
            select: { visitorGroupId: true },
          },
          _count: {
            select: { views: { where: { viewType: "DATAROOM_VIEW" } } },
          },
        },
      });

      let extendedLinks: LinkWithViews[] = links as LinkWithViews[];
      // Decrypt the password for each link
      if (extendedLinks && extendedLinks.length > 0) {
        extendedLinks = await Promise.all(
          extendedLinks.map(async (link) => {
            // Decrypt the password if it exists
            if (link.password !== null) {
              link.password = decryptEncrpytedPassword(link.password);
            }
            if (link.enableUpload) {
              // Prefer the new multi-folder allow-list, but fall back to the
              // legacy single folder id so links created before the migration
              // keep rendering correctly in the link sheet.
              const allowedIds: string[] = Array.from(
                new Set(
                  [
                    ...(Array.isArray(link.uploadFolderIds)
                      ? link.uploadFolderIds
                      : []),
                    ...(link.uploadFolderId ? [link.uploadFolderId] : []),
                  ].filter((id): id is string => !!id),
                ),
              );

              if (allowedIds.length > 0) {
                const folders = await prisma.dataroomFolder.findMany({
                  where: {
                    id: { in: allowedIds },
                    dataroomId,
                  },
                  select: { id: true, name: true, path: true },
                });
                // Preserve the admin-selected order when possible.
                const byId = new Map(folders.map((f) => [f.id, f]));
                const ordered = allowedIds
                  .map((id) => byId.get(id))
                  .filter((f): f is (typeof folders)[number] => !!f);
                link.uploadFolders = ordered;
                link.uploadFolderName = ordered[0]?.name;
              }
            }
            const tags = await prisma.tag.findMany({
              where: {
                items: {
                  some: {
                    linkId: link.id,
                    itemType: "LINK_TAG",
                  },
                },
              },
              select: {
                id: true,
                name: true,
                color: true,
                description: true,
              },
            });

            return {
              ...link,
              tags,
            };
          }),
        );
      }

      // console.log("links", links);
      return res.status(200).json(extendedLinks);
    } catch (error) {
      log({
        message: `Failed to get links for dataroom: _${dataroomId}_. \n\n ${error} \n\n*Metadata*: \`{teamId: ${teamId}, userId: ${userId}}\``,
        type: "error",
      });
      errorhandler(error, res);
    }
  } else {
    // We only allow GET requests
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
