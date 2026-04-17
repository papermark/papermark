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
      select: { globalBlockList: true },
    });

    return res.status(200).json(team?.globalBlockList || []);
  }

  if (req.method === "PUT") {
    if (teamAccess.role !== "ADMIN" && teamAccess.role !== "MANAGER") {
      return res.status(403).json({
        error: "Only admins and managers can manage the block list.",
      });
    }

    try {
      const { blockList } = req.body;

      if (!Array.isArray(blockList)) {
        return res.status(400).json({ error: "Invalid block list" });
      }

      const uniqueBlockList = sanitizeList(blockList.join("\n"), "both");

      await prisma.team.update({
        where: { id: teamId },
        data: { globalBlockList: uniqueBlockList },
      });

      return res.status(200).json({ message: "Global block list updated" });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  res.setHeader("Allow", ["GET", "PUT"]);
  return res.status(405).json({ error: "Method not allowed" });
}

export default handler;
