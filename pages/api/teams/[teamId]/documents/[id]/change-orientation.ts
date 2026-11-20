import { NextApiRequest, NextApiResponse } from "next";

import { Prisma } from "@prisma/client";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";
import { z } from "zod";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

const changeOrientationSchema = z.object({
  versionId: z.string().min(1, "versionId is required"),
  isVertical: z.boolean(),
});

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    // GET /api/teams/:teamId/documents/:id/update-name
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId, id: docId } = req.query as { teamId: string; id: string };

    const parsed = changeOrientationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid input",
        details: parsed.error.errors,
      });
    }
    const { versionId, isVertical } = parsed.data;

    const userId = (session.user as CustomUser).id;

    try {
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId,
            },
          },
          documents: {
            some: {
              id: {
                equals: docId,
              },
            },
          },
        },
        select: {
          id: true,
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      try {
        await prisma.documentVersion.update({
          where: {
            id: versionId,
            documentId: docId,
          },
          data: {
            isVertical,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2025"
        ) {
          return res
            .status(404)
            .json({ message: "Document version not found" });
        }
        throw err;
      }

      await fetch(
        `${process.env.NEXTAUTH_URL}/api/revalidate?secret=${process.env.REVALIDATE_TOKEN}&documentId=${docId}`,
      );

      return res.status(200).json({
        message: `Document orientation changed to ${isVertical ? "portrait" : "landscape"}!`,
      });
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    // We only allow POST requests
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
