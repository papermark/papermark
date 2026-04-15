import { NextApiRequest, NextApiResponse } from "next";

import { getServerSession } from "next-auth";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { sanitizeList } from "@/lib/utils";

import { authOptions } from "../../auth/[...nextauth]";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { teamId } = req.query;

  if (typeof teamId !== "string") {
    return res.status(400).json({ error: "Invalid teamId" });
  }

  const userId = (session.user as CustomUser).id;

  const teamAccess = await prisma.userTeam.findUnique({
    where: {
      userId_teamId: {
        userId,
        teamId,
      },
    },
    select: { role: true },
  });

  if (!teamAccess) {
    return res.status(404).json({ error: "Team not found" });
  }

  if (req.method === "GET") {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { ignoredDomains: true },
    });

    return res.status(200).json(team?.ignoredDomains || []);
  }

  if (req.method === "PUT") {
    if (teamAccess.role !== "ADMIN" && teamAccess.role !== "MANAGER") {
      return res.status(403).json({
        error: "Only admins and managers can manage ignored domains.",
      });
    }

    try {
      const { domains } = req.body;

      if (!Array.isArray(domains)) {
        return res.status(400).json({ error: "Invalid domains list" });
      }

      const uniqueDomains = sanitizeList(domains.join("\n"), "domain");

      await prisma.team.update({
        where: { id: teamId },
        data: { ignoredDomains: uniqueDomains },
      });

      return res.status(200).json({ message: "Ignored domains updated" });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  res.setHeader("Allow", ["GET", "PUT"]);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

export default handler;
