import { NextApiRequest, NextApiResponse } from "next";

import { runs } from "@trigger.dev/sdk";
import { getServerSession } from "next-auth/next";
import { z } from "zod";

import { authOptions } from "@/lib/auth/auth-options";
import { TeamError, errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import {
  getSigningEmbedConfig,
  isSigningAgreement,
} from "@/lib/signing/agreements";
import { getSigningClient } from "@/lib/signing/client";
import { DEFAULT_SIGNING_SETUP_FAILURE_MESSAGE } from "@/lib/signing/setup-status";
import { CustomUser } from "@/lib/types";

const setupStatusQuerySchema = z.object({
  runId: z.string().min(1),
});

const setupTaskOutputSchema = z.object({
  externalId: z.string().nullable(),
  envelopeId: z.string().min(1),
  templateId: z.string().min(1),
});

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

  try {
    const parseResult = setupStatusQuerySchema.safeParse(req.query);

    if (!parseResult.success) {
      throw new TeamError("A valid signing setup run ID is required.");
    }

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
        contentType: true,
        signingProvider: true,
      },
    });

    if (!agreement) {
      throw new TeamError("Agreement not found.");
    }

    if (!isSigningAgreement(agreement)) {
      throw new TeamError(
        "Only embedded signing agreements can check signing setup.",
      );
    }

    const run = await runs.retrieve(parseResult.data.runId);
    const metadata = run.metadata as Record<string, unknown> | undefined;

    if (metadata?.teamId !== teamId || metadata?.agreementId !== agreement.id) {
      return res.status(403).end("Unauthorized");
    }

    if (run.isFailed) {
      console.error("[signing] setup task failed", {
        agreementId,
        teamId,
        runId: run.id,
        status: run.status,
      });
      // Return a terminal `failed` state (200) rather than a 5xx so the polling
      // client can distinguish a genuinely failed run from a transient server
      // error (which it should keep retrying).
      return res.status(200).json({
        state: "failed",
        runId: run.id,
        status: run.status,
        message: DEFAULT_SIGNING_SETUP_FAILURE_MESSAGE,
      });
    }

    if (!run.isCompleted) {
      return res.status(202).json({
        state: "pending",
        runId: run.id,
        status: run.status,
        metadata: run.metadata,
      });
    }

    const output = setupTaskOutputSchema.safeParse(run.output);

    if (!output.success) {
      console.error("[signing] setup task returned invalid output", {
        agreementId,
        teamId,
        runId: run.id,
        issues: output.error.issues,
      });
      throw new TeamError(
        "Signing setup completed with invalid provider metadata.",
      );
    }

    const signingClient = getSigningClient();
    const presignToken =
      await signingClient.embedding.embeddingPresignCreateEmbeddingPresignToken(
        {
          expiresIn: 3600,
        },
      );

    return res.status(200).json({
      state: "completed",
      presignToken: presignToken.token,
      expiresAt: presignToken.expiresAt,
      externalId: output.data.externalId,
      envelopeId: output.data.envelopeId,
      ...getSigningEmbedConfig(),
    });
  } catch (error) {
    return errorhandler(error, res);
  }
}
