import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { isSigningAgreement } from "@/lib/signing/agreements";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const userId = (session.user as CustomUser).id;
  const { teamId, agreementId } = req.query as {
    teamId: string;
    agreementId: string;
  };

  if (!teamId || !agreementId) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    const agreement = await prisma.agreement.findFirst({
      where: {
        id: agreementId,
        teamId,
        team: {
          users: {
            some: {
              userId,
            },
          },
        },
      },
      select: {
        id: true,
        name: true,
        contentType: true,
        signingProvider: true,
        signingEnvelopeId: true,
        signingTemplateId: true,
      },
    });

    if (!agreement) {
      return res.status(404).json({ error: "Agreement not found" });
    }

    const signing = isSigningAgreement(agreement);

    const responses = await prisma.agreementResponse.findMany({
      where: {
        agreementId,
        ...(signing
          ? {
              signingStatus: {
                in: ["SIGNED", "COMPLETED"],
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        signingStatus: true,
        signingEnvelopeId: true,
        signingExternalId: true,
        signedAt: true,
        completedAt: true,
        createdAt: true,
        linkId: true,
        signerEmail: true,
        signerName: true,
        view: {
          select: {
            id: true,
            viewerEmail: true,
            viewerName: true,
            viewedAt: true,
            linkId: true,
            link: {
              select: {
                id: true,
                name: true,
              },
            },
            document: {
              select: {
                id: true,
                name: true,
              },
            },
            dataroom: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    // Resolve link names for signed-but-incomplete responses that have no View, only a top-level linkId.
    const orphanLinkIds = Array.from(
      new Set(
        responses
          .filter((response) => !response.view && response.linkId)
          .map((response) => response.linkId!)
          .filter((value): value is string => typeof value === "string"),
      ),
    );

    const orphanLinks =
      orphanLinkIds.length > 0
        ? await prisma.link.findMany({
            where: {
              id: { in: orphanLinkIds },
              teamId,
            },
            select: { id: true, name: true },
          })
        : [];

    const orphanLinksById = new Map(
      orphanLinks.map((link) => [link.id, link]),
    );

    const responsesWithLink = responses.map((response) => ({
      ...response,
      link:
        response.linkId && !response.view
          ? orphanLinksById.get(response.linkId) ?? null
          : null,
    }));

    return res.status(200).json({
      agreement: {
        id: agreement.id,
        name: agreement.name,
        contentType: agreement.contentType,
        signingProvider: agreement.signingProvider,
        isSigning: signing,
      },
      responses: responsesWithLink,
    });
  } catch (error) {
    return errorhandler(error, res);
  }
}
