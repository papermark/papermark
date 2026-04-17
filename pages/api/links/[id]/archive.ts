import { NextApiRequest, NextApiResponse } from "next";

import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

import { authOptions } from "../../auth/[...nextauth]";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "PUT") {
    // PUT /api/links/:id/archive
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { id } = req.query as { id: string };

    const { isArchived, teamId } = req.body as {
      isArchived: boolean;
      teamId?: string;
    };

    if (!teamId) {
      return res.status(400).json({ error: "teamId is required" });
    }

    const userId = (session.user as CustomUser).id;

    try {
      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId,
            teamId,
          },
        },
      });

      if (!teamAccess) {
        return res.status(403).end("Forbidden");
      }

      const link = await prisma.link.findUnique({
        where: { id, teamId, deletedAt: null },
        select: { dataroom: { select: { isFrozen: true } } },
      });

      if (!link) {
        return res.status(404).json({ error: "Link not found" });
      }

      if (link.dataroom?.isFrozen) {
        return res.status(403).json({
          error:
            "This data room is frozen. You cannot change link status for a frozen data room.",
        });
      }

      // Update the link in the database
      const updatedLink = await prisma.link.update({
        where: { id, teamId, deletedAt: null },
        data: {
          isArchived: isArchived,
        },
        include: {
          views: {
            orderBy: {
              viewedAt: "desc",
            },
          },
          _count: {
            select: { views: true },
          },
          tags: {
            select: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  color: true,
                },
              },
            },
          },
        },
      });
      if (!updatedLink) {
        return res.status(404).json({ error: "Link not found" });
      }

      const { tags, ...rest } = updatedLink;
      const linkTags = tags.map((t) => t.tag);

      await fetch(
        `${process.env.NEXTAUTH_URL}/api/revalidate?secret=${process.env.REVALIDATE_TOKEN}&linkId=${id}&hasDomain=${updatedLink.domainId ? "true" : "false"}`,
      );

      return res.status(200).json({ ...rest, tags: linkTags });
    } catch (error) {
      errorhandler(error, res);
    }
  }

  // We only allow PUT requests
  res.setHeader("Allow", ["PUT"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
