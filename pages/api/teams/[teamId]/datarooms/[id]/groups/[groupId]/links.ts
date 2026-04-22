import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser, LinkWithViews } from "@/lib/types";
import { decryptEncrpytedPassword, log } from "@/lib/utils";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/groups/:groupId/links
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const {
      teamId,
      id: dataroomId,
      groupId,
    } = req.query as {
      teamId: string;
      id: string;
      groupId: string;
    };
    const userId = (session.user as CustomUser).id;

    try {
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: (session.user as CustomUser).id,
            },
          },
        },
        select: {
          id: true,
        },
      });

      if (!team) {
        return res.status(403).end("Unauthorized to access this team");
      }

      let links = await prisma.link.findMany({
        where: {
          groupId: groupId,
          dataroomId: dataroomId,
          linkType: "DATAROOM_LINK",
          deletedAt: null,
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
      if (extendedLinks && extendedLinks.length > 0) {
        extendedLinks = await Promise.all(
          extendedLinks.map(async (link) => {
            // Decrypt the password if it exists
            if (link.password !== null) {
              link.password = decryptEncrpytedPassword(link.password);
            }
            // Get the upload folder name(s) if any folder is restricted
            if (link.enableUpload) {
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
                const byId = new Map(folders.map((f) => [f.id, f]));
                const ordered = allowedIds
                  .map((id) => byId.get(id))
                  .filter((f): f is (typeof folders)[number] => !!f);
                link.uploadFolders = ordered;
                link.uploadFolderName = ordered[0]?.name;
              }
            }
            // Get the tags for the link
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

      return res.status(200).json(extendedLinks);
    } catch (error) {
      log({
        message: `Failed to get links for dataroom: _${dataroomId}_,group: _${groupId}_. \n\n ${error} \n\n*Metadata*: \`{teamId: ${teamId}, groupId: ${groupId}, userId: ${userId}}\``,
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
