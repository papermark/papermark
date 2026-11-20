import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { enforceDocumentMemberScope } from "@/lib/api/rbac/guard";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/documents/:id/views/:viewId/custom-fields
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const {
      teamId,
      id: docId,
      viewId,
    } = req.query as {
      teamId: string;
      id: string;
      viewId: string;
    };

    const userId = (session.user as CustomUser).id;

    // Scoped members may only read views for documents in their assigned rooms.
    if (
      await enforceDocumentMemberScope({
        userId,
        teamId,
        documentId: docId,
        res,
      })
    ) {
      return;
    }

    try {
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: userId,
            },
          },
        },
        select: {
          id: true,
          plan: true,
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      if (team.plan.includes("free")) {
        return res.status(403).end("Forbidden");
      }

      const customFields = await prisma.customFieldResponse.findFirst({
        where: {
          viewId: viewId,
          view: {
            documentId: docId,
          },
        },
        select: {
          data: true,
        },
      });

      const data = customFields?.data;

      return res.status(200).json(data);
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    // We only allow GET requests
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
