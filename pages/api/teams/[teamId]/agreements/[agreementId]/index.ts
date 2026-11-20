import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";
import { z } from "zod";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { validateContent } from "@/lib/utils/sanitize-html";

const updateAgreementSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(150, "Name must be less than 150 characters")
    .optional(),
  content: z
    .string()
    .max(3000, "Content must be less than 3000 characters")
    .optional(),
  requireName: z.boolean().optional(),
});

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "PATCH") {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const userId = (session.user as CustomUser).id;
    const { teamId, agreementId } = req.query as {
      teamId: string;
      agreementId: string;
    };

    if (!teamId || !agreementId) {
      return res.status(401).json("Unauthorized");
    }

    try {
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId,
            },
          },
        },
        select: { id: true },
      });

      if (!team) {
        return res.status(401).json("Unauthorized");
      }

      const parseResult = updateAgreementSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const existing = await prisma.agreement.findFirst({
        where: {
          id: agreementId,
          teamId,
          deletedAt: null,
        },
        select: { id: true, contentType: true },
      });

      if (!existing) {
        return res.status(404).json({ error: "Agreement not found" });
      }

      const { name, content, requireName } = parseResult.data;

      const data: {
        name?: string;
        content?: string;
        requireName?: boolean;
      } = {};

      if (typeof name === "string") {
        data.name = name.trim();
      }
      if (typeof requireName === "boolean") {
        data.requireName = requireName;
      }
      if (typeof content === "string") {
        if (existing.contentType === "SIGNING") {
          return res.status(400).json({
            error:
              "Signing agreement content is managed through the signing template and cannot be edited here.",
          });
        }
        data.content =
          existing.contentType === "LINK"
            ? content.trim()
            : validateContent(content, 3000);
      }

      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      const updated = await prisma.agreement.update({
        where: { id: agreementId },
        data,
      });

      return res.status(200).json(updated);
    } catch (error) {
      errorhandler(error, res);
    }
  } else if (req.method === "PUT") {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const userId = (session.user as CustomUser).id;
    const { teamId } = req.query as { teamId: string };
    const { agreementId } = req.query as { agreementId: string };

    if (!teamId || !agreementId) {
      return res.status(401).json("Unauthorized");
    }

    try {
      await prisma.agreement.update({
        where: {
          id: agreementId,
          teamId,
        },
        data: {
          deletedAt: new Date(),
          deletedBy: userId,
        },
      });

      return res.status(200).json({ message: "Agreement deleted" });
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    res.setHeader("Allow", ["PATCH", "PUT"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
