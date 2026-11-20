import { NextApiRequest, NextApiResponse } from "next";

import { getServerSession } from "next-auth/next";
import { z } from "zod";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import {
  buildAgreementSigningExternalId,
  getSigningAgreementCreateData,
} from "@/lib/signing/agreements";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";
import { validateContent } from "@/lib/utils/sanitize-html";

import { authOptions } from "../../../auth/[...nextauth]";

// Zod schema for agreement creation
const createAgreementSchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .max(150, "Name must be less than 150 characters"),
    content: z
      .string()
      .max(3000, "Content must be less than 3000 characters")
      .optional(),
    contentType: z.enum(["LINK", "TEXT", "SIGNING"]).default("SIGNING"),
    requireName: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.contentType !== "SIGNING" && !data.content?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Content is required",
        path: ["content"],
      });
    }
  });

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/agreements
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId } = req.query as { teamId: string };
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
        },
        select: {
          agreements: {
            include: {
              _count: {
                select: {
                  links: {
                    where: {
                      deletedAt: null,
                    },
                  },
                  responses: {
                    where: {
                      signingStatus: {
                        in: ["SIGNED", "COMPLETED"],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!team) {
        return res.status(401).json("Unauthorized");
      }

      const agreements = team.agreements;
      return res.status(200).json(agreements);
    } catch (error) {
      errorhandler(error, res);
    }
  } else if (req.method === "POST") {
    // POST /api/teams/:teamId/agreements
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const userId = (session.user as CustomUser).id;
    const { teamId } = req.query as { teamId: string };

    if (!teamId) {
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
      });

      if (!team) {
        return res.status(401).json("Unauthorized");
      }

      // Validate and parse request body
      const parseResult = createAgreementSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const { name, content, contentType, requireName } = parseResult.data;

      const sanitizedContent =
        contentType === "SIGNING"
          ? content?.trim()
          : validateContent(content || "", 3000);

      const agreement = await prisma.$transaction(async (tx) => {
        const created = await tx.agreement.create({
          data: getSigningAgreementCreateData({
            teamId,
            name,
            content: sanitizedContent,
            contentType,
            requireName,
          }),
        });

        if (contentType === "SIGNING") {
          return tx.agreement.update({
            where: {
              id: created.id,
            },
            data: {
              signingExternalId: buildAgreementSigningExternalId(
                teamId,
                created.id,
              ),
            },
          });
        }

        return created;
      });

      return res.status(201).json(agreement);
    } catch (error) {
      log({
        message: `Failed to add agreement. \n\n ${error} \n\n*Metadata*: \`{teamId: ${teamId}, userId: ${userId}}\``,
        type: "error",
        mention: true,
      });
      errorhandler(error, res);
    }
  } else {
    // We only allow GET and POST requests
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
