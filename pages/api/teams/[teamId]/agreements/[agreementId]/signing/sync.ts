import { NextApiRequest, NextApiResponse } from "next";

import { getServerSession } from "next-auth/next";
import { z } from "zod";

import { TeamError, errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import {
  deleteSigningTemplateDirectLink,
  ensureSigningTemplateDirectLink,
  ensureSigningTemplateViewerRecipient,
  ensureTeamSigningFolders,
  isSigningAgreement,
} from "@/lib/signing/agreements";
import { getSigningClient } from "@/lib/signing/client";
import { getEnvelope } from "@/lib/signing/envelopes";
import { CustomUser } from "@/lib/types";

import { authOptions } from "../../../../../auth/[...nextauth]";

const syncAgreementSchema = z.object({
  envelopeId: z.string().min(1, "Envelope ID is required."),
});

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
    const parseResult = syncAgreementSchema.safeParse(req.body);

    if (!parseResult.success) {
      console.warn("[signing] sync schema parse failed", {
        issues: parseResult.error.issues,
      });
      throw new TeamError("A valid signing envelope ID is required.");
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
        signingProvider: true,
        signingExternalId: true,
        signingEnvelopeId: true,
        signingTemplateId: true,
        contentType: true,
      },
    });

    if (!agreement) {
      throw new TeamError("Agreement not found.");
    }

    if (!isSigningAgreement(agreement)) {
      throw new TeamError(
        "Only embedded signing agreements can sync provider metadata.",
      );
    }

    // Only sync the envelope already bound to this agreement; never trust an arbitrary request envelopeId that could attach an unrelated template.
    if (
      !agreement.signingEnvelopeId ||
      agreement.signingEnvelopeId !== parseResult.data.envelopeId
    ) {
      console.warn("[signing] sync rejected unbound envelope", {
        agreementId,
        requestedEnvelopeId: parseResult.data.envelopeId,
        boundEnvelopeId: agreement.signingEnvelopeId,
      });
      throw new TeamError(
        "This signing envelope is not bound to the agreement.",
      );
    }

    // Single keyed envelope lookup instead of a separate get plus paginated find.
    const signingClient = getSigningClient();
    const envelope = await getEnvelope(parseResult.data.envelopeId);

    if (envelope.type !== "TEMPLATE") {
      console.warn("[signing] sync rejected non-TEMPLATE envelope", {
        envelopeId: envelope.id,
        type: envelope.type,
        status: envelope.status,
      });
      throw new TeamError(
        "Signing envelopes must be templates before they can be attached to an agreement.",
      );
    }

    // Stored signingTemplateId is the source of truth (TEMPLATE envelopes report null); fall back to the envelope only if it carries one.
    const templateId =
      agreement.signingTemplateId ??
      (envelope.templateId ? String(envelope.templateId) : null);

    if (!templateId) {
      throw new TeamError(
        "Agreement is missing the numeric signing template id. Re-upload the agreement to fix this.",
      );
    }

    await deleteSigningTemplateDirectLink({
      signingTemplateId: templateId,
    });

    await ensureSigningTemplateViewerRecipient({
      envelopeId: envelope.id,
    });

    let templateFolderId: string | null = null;
    try {
      ({ templateFolderId } = await ensureTeamSigningFolders(teamId));
    } catch (folderError) {
      // Folder placement is best-effort: never block envelope sync on it.
      console.error(
        "[signing] Failed to ensure team signing folders during sync.",
        folderError,
      );
    }

    const shouldUpdateFolder =
      templateFolderId !== null && envelope.folderId !== templateFolderId;

    await signingClient.envelopes.update({
      envelopeId: envelope.id,
      data: {
        title: agreement.name,
        externalId: agreement.signingExternalId,
        ...(shouldUpdateFolder ? { folderId: templateFolderId } : {}),
      },
      meta: {
        subject: agreement.name,
        distributionMethod: "NONE",
        emailSettings: {
          recipientSigningRequest: false,
          recipientRemoved: false,
          recipientSigned: false,
          documentPending: false,
          documentCompleted: false,
          documentDeleted: false,
          ownerDocumentCompleted: false,
          ownerRecipientExpired: false,
          ownerDocumentCreated: false,
        },
      },
    });

    // Mint the direct link once the template is saved; idempotent, so re-runs return the existing token.
    await ensureSigningTemplateDirectLink({
      signingTemplateId: templateId,
    });

    const updatedAgreement = await prisma.agreement.update({
      where: {
        id: agreementId,
      },
      data: {
        signingEnvelopeId: envelope.id,
        signingTemplateId: templateId,
      },
    });

    return res.status(200).json(updatedAgreement);
  } catch (error) {
    console.error("[signing] sync handler error", {
      agreementId,
      teamId,
      message: error instanceof Error ? error.message : String(error),
    });
    return errorhandler(error, res);
  }
}
