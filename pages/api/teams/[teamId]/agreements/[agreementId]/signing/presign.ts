import { NextApiRequest, NextApiResponse } from "next";

import { getServerSession } from "next-auth/next";

import { authOptions } from "@/lib/auth/auth-options";
import { TeamError, errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import {
  deleteSigningTemplateDirectLink,
  ensureSigningTemplateViewerRecipient,
  getSigningEmbedConfig,
  isSigningAgreement,
} from "@/lib/signing/agreements";
import { getSigningClient } from "@/lib/signing/client";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
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

  try {
    const agreement = await prisma.agreement.findFirst({
      where: {
        id: agreementId,
        teamId,
        deletedAt: null,
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
        signingExternalId: true,
        signingEnvelopeId: true,
        signingTemplateId: true,
        signingProvider: true,
        contentType: true,
        _count: {
          select: {
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
    });

    if (!agreement) {
      throw new TeamError("Agreement not found.");
    }

    if (!isSigningAgreement(agreement)) {
      throw new TeamError(
        "Only embedded signing agreements can launch authoring.",
      );
    }

    if (!agreement.signingEnvelopeId) {
      throw new TeamError(
        "This signing agreement is missing its template. Please create a new signing agreement.",
      );
    }

    if (!agreement.signingTemplateId) {
      throw new TeamError(
        "This signing agreement is missing its numeric template id. Please re-upload the agreement.",
      );
    }

    if (agreement._count.responses > 0) {
      throw new TeamError(
        "Signing fields cannot be edited after signatures have been collected.",
      );
    }

    await deleteSigningTemplateDirectLink({
      signingTemplateId: agreement.signingTemplateId,
    });

    await ensureSigningTemplateViewerRecipient({
      envelopeId: agreement.signingEnvelopeId,
    });

    const signingClient = getSigningClient();
    const presignToken =
      await signingClient.embedding.embeddingPresignCreateEmbeddingPresignToken(
        {
          expiresIn: 3600,
        },
      );

    return res.status(200).json({
      presignToken: presignToken.token,
      expiresAt: presignToken.expiresAt,
      externalId: agreement.signingExternalId,
      envelopeId: agreement.signingEnvelopeId,
      ...getSigningEmbedConfig(),
    });
  } catch (error) {
    return errorhandler(error, res);
  }
}
