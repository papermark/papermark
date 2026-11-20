import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/groups/:groupId
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
      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: userId,
            teamId: teamId,
          },
        },
      });

      if (!teamAccess) {
        return res.status(403).end("Unauthorized to access this team");
      }

      const group = await prisma.viewerGroup.findUnique({
        where: {
          id: groupId,
          dataroomId: dataroomId,
          teamId: teamId,
        },
        include: {
          members: {
            include: {
              viewer: {
                include: {
                  invitations: {
                    where: {
                      groupId: groupId,
                    },
                    orderBy: {
                      sentAt: "desc",
                    },
                    take: 1,
                  },
                },
              },
            },
          },
          accessControls: true,
        },
      });

      if (!group) {
        return res.status(404).end("Group not found");
      }

      return res.status(200).json(group);
    } catch (error) {
      log({
        message: `Failed to get group for dataroom: _${dataroomId}_. \n\n ${error} \n\n*Metadata*: \`{teamId: ${teamId}, userId: ${userId}}\``,
        type: "error",
      });
      errorhandler(error, res);
    }
  } else if (req.method === "PATCH") {
    // PATCH /api/teams/:teamId/datarooms/:id/groups/:groupId
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

    const { name, allowAll, domains } = req.body as {
      name?: string;
      allowAll?: boolean;
      domains?: string[];
    };
    const userId = (session.user as CustomUser).id;

    try {
      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: userId,
            teamId: teamId,
          },
        },
      });
      if (!teamAccess) {
        return res.status(403).end("Unauthorized to access this team");
      }

      const group = await prisma.viewerGroup.update({
        where: {
          id: groupId,
          dataroomId: dataroomId,
          teamId: teamId,
          team: {
            users: {
              some: {
                userId: userId,
              },
            },
          },
        },
        data: {
          ...(name && { name }),
          ...(typeof allowAll === "boolean" && { allowAll }),
          ...(domains && { domains }),
        },
      });

      return res.status(200).json(group);
    } catch (error) {
      log({
        message: `Failed to update group for dataroom: _${dataroomId}_. \n\n ${error} \n\n*Metadata*: \`{groupId: ${groupId}, teamId: ${teamId}, userId: ${userId}}\``,
        type: "error",
      });
      errorhandler(error, res);
    }
  } else if (req.method === "DELETE") {
    // DELETE /api/teams/:teamId/datarooms/:id/groups/:groupId
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
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
      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: userId,
            teamId: teamId,
          },
        },
      });

      if (!teamAccess) {
        return res.status(401).end("Unauthorized");
      }

      await prisma.$transaction([
        // delete links associated with the group
        prisma.link.deleteMany({
          where: {
            groupId: groupId,
            dataroomId: dataroomId,
            teamId: teamId,
          },
        }),

        // delete group
        prisma.viewerGroup.delete({
          where: {
            id: groupId,
            dataroomId: dataroomId,
            teamId: teamId,
          },
        }),
      ]);

      res.status(200).json({ success: true });
      return;
    } catch (error) {
      log({
        message: `Failed to delete group for dataroom: _${dataroomId}_. \n\n ${error} \n\n*Metadata*: \`{groupId: ${groupId}, teamId: ${teamId}, userId: ${userId}}\``,
        type: "error",
      });
      errorhandler(error, res);
    }
  } else {
    // We only allow GET, PATCH, DELETE requests
    res.setHeader("Allow", ["GET", "PATCH", "DELETE"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
