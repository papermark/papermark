import { NextApiRequest, NextApiResponse } from "next";

import { DocumentStorageType } from "@prisma/client";
import { auth } from "@trigger.dev/sdk";
import { getServerSession } from "next-auth/next";
import { z } from "zod";

import { authOptions } from "@/lib/auth/auth-options";
import { TeamError, errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { isSigningAgreement } from "@/lib/signing/agreements";
import {
  MAX_SIGNING_TEMPLATE_PDF_BYTES,
  SIGNING_TEMPLATE_PDF_CONTENT_TYPE,
  getSigningTemplateTooLargeMessage,
} from "@/lib/signing/template-upload";
import { setupSigningTemplateTask } from "@/lib/trigger/setup-signing-template";
import { CustomUser } from "@/lib/types";

export const config = {
  maxDuration: 60,
};

const setupSigningTemplateSchema = z.object({
  fileName: z.string().trim().min(1).optional(),
  contentType: z.literal(SIGNING_TEMPLATE_PDF_CONTENT_TYPE),
  file: z.object({
    data: z.string().min(1),
    storageType: z.nativeEnum(DocumentStorageType),
    fileSize: z.number().int().positive(),
  }),
});

const sanitizeFileName = (raw: string | undefined | null) => {
  const fallback = "agreement.pdf";

  if (!raw) {
    return fallback;
  }

  try {
    const decoded = decodeURIComponent(raw);
    const trimmed = decoded.trim().replace(/[\r\n]+/g, " ");
    return trimmed.length > 0 ? trimmed : fallback;
  } catch {
    return fallback;
  }
};

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
    const parseResult = setupSigningTemplateSchema.safeParse(req.body);

    if (!parseResult.success) {
      throw new TeamError(
        "Upload the agreement as a PDF before starting signing setup.",
      );
    }

    const setupRequest = parseResult.data;

    if (setupRequest.file.fileSize > MAX_SIGNING_TEMPLATE_PDF_BYTES) {
      throw new TeamError(getSigningTemplateTooLargeMessage());
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
        name: true,
        contentType: true,
        signingProvider: true,
        signingExternalId: true,
        signingEnvelopeId: true,
      },
    });

    if (!agreement) {
      throw new TeamError("Agreement not found.");
    }

    if (!isSigningAgreement(agreement)) {
      throw new TeamError(
        "Only embedded signing agreements can attach a PDF template.",
      );
    }

    if (agreement.signingEnvelopeId) {
      throw new TeamError(
        "This agreement is already linked to a signing template.",
      );
    }

    const fileName = sanitizeFileName(setupRequest.fileName);

    const run = await setupSigningTemplateTask.trigger(
      {
        agreementId: agreement.id,
        teamId,
        file: {
          fileName,
          data: setupRequest.file.data,
          storageType: setupRequest.file.storageType,
          fileSize: setupRequest.file.fileSize,
        },
      },
      {
        idempotencyKey: `${teamId}-${agreement.id}-signing-template-setup`,
        tags: [`team_${teamId}`, `agreement_${agreement.id}`],
        concurrencyKey: teamId,
        metadata: {
          teamId,
          agreementId: agreement.id,
          userId,
        },
      },
    );

    // Read-only token so the client can follow setup via Trigger.dev Realtime instead of polling.
    const publicAccessToken = await auth.createPublicToken({
      scopes: {
        read: {
          runs: [run.id],
        },
      },
      expirationTime: "15m",
    });

    return res.status(202).json({
      runId: run.id,
      publicAccessToken,
    });
  } catch (error) {
    return errorhandler(error, res);
  }
}
