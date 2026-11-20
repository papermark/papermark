import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { enforceDocumentMemberScope } from "@/lib/api/rbac/guard";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { getViewUserAgent, getViewUserAgent_v2 } from "@/lib/tinybird";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/documents/:id/views/:viewId/user-agent
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

      let userAgent: {
        rows?: number | undefined;
        data: {
          country: string;
          city: string;
          browser: string;
          os: string;
          device: string;
        }[];
      };

      userAgent = await getViewUserAgent({
        viewId: viewId,
      });

      if (!userAgent || userAgent.rows === 0) {
        userAgent = await getViewUserAgent_v2({
          documentId: docId,
          viewId: viewId,
          since: 0,
        });
      }

      const userAgentData = userAgent.data[0];
      // Include country and city for business and datarooms plans
      if (team.plan.includes("business") || team.plan.includes("datarooms")) {
        return res.status(200).json(userAgentData);
      } else {
        // For other plans, exclude country and city
        const { country, city, ...remainingResponse } = userAgentData;
        return res.status(200).json(remainingResponse);
      }
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    // We only allow GET and POST requests
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
