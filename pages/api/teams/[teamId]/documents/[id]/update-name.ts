import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";
import { z } from "zod";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { sanitizePlainText } from "@/lib/utils/sanitize-html";

const updateNameSchema = z.object({
  name: z
    .string()
    .transform((value) => sanitizePlainText(value))
    .pipe(
      z
        .string()
        .min(1, "Document name is required")
        .max(255, "Document name too long"),
    ),
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

    const userId = (session.user as CustomUser).id;

    try {
      // Validate input using Zod
      const validationResult = updateNameSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid input",
          details: validationResult.error.issues,
        });
      }

      const { name } = validationResult.data;

      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId,
            teamId,
          },
        },
      });

      if (!teamAccess) {
        return res.status(401).end("Unauthorized");
      }

      // Atomic transaction to update document name
      const result = await prisma.$transaction(async (tx) => {
        // Perform atomic update with both teamId and id in the filter
        const document = await tx.document.findUnique({
          where: {
            id: docId,
            teamId: teamId, // Ensure document belongs to the team
          },
          select: { id: true },
        });

        if (!document) {
          return null;
        }

        const updateResult = await tx.document.update({
          where: { id: docId, teamId },
          data: { name: name },
        });

        return updateResult;
      });

      if (!result) {
        return res.status(404).json({ error: "Document not found" });
      }

      return res.status(200).json({ message: "Document name updated!" });
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    // We only allow POST requests
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
