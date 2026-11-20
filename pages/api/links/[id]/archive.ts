import { NextApiRequest, NextApiResponse } from "next";

import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import { dashboardLinkInclude } from "@/lib/api/links/dashboard-include";
import { revalidateLinkById } from "@/lib/api/links/revalidate";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

import { authOptions } from "../../auth/[...nextauth]";

export const config = {
  supportsResponseStreaming: true,
};

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
        select: {
          linkType: true,
          dataroom: { select: { isFrozen: true } },
        },
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

      const updatedLink = await prisma.link.update({
        where: { id, teamId, deletedAt: null },
        data: {
          isArchived: isArchived,
        },
        include: dashboardLinkInclude(link.linkType),
      });
      if (!updatedLink) {
        return res.status(404).json({ error: "Link not found" });
      }

      const { tags, ...rest } = updatedLink;
      const linkTags = tags.map((t) => t.tag);

      waitUntil(revalidateLinkById(id));

      return res.status(200).json({ ...rest, tags: linkTags });
    } catch (error) {
      return errorhandler(error, res);
    }
  }

  // We only allow PUT requests
  res.setHeader("Allow", ["PUT"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
