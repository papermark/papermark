import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import crypto from "crypto";
import { z } from "zod";

import { TeamError } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";

import {
  getSigningClient,
  getSigningHost,
  getSigningWebhookSecret,
} from "./client";
import { getEnvelope } from "./envelopes";

export const SIGNING_PROVIDER_SCHEMA = z.enum(["LEGACY", "DOCUMENSO"]);
export const SIGNING_STATUS_SCHEMA = z.enum([
  "PENDING",
  "SIGNED",
  "COMPLETED",
  "FAILED",
]);

export type SigningProvider = z.infer<typeof SIGNING_PROVIDER_SCHEMA>;
export type SigningStatus = z.infer<typeof SIGNING_STATUS_SCHEMA>;

const SIGNING_TEMPLATE_ID_SCHEMA = z.coerce.number().int().positive();

export const buildAgreementSigningExternalId = (
  teamId: string,
  agreementId: string,
) => {
  return `papermark:team:${teamId}:agreement:${agreementId}`;
};

export const buildAgreementResponseSigningExternalId = (
  teamId: string,
  agreementResponseId: string,
) => {
  return `papermark:team:${teamId}:agreement-response:${agreementResponseId}`;
};

export const isSigningAgreement = ({
  signingProvider,
  contentType,
}: {
  signingProvider?: string | null;
  contentType?: string | null;
}) => {
  const provider = SIGNING_PROVIDER_SCHEMA.safeParse(signingProvider);

  return (
    (provider.success && provider.data === "DOCUMENSO") ||
    contentType === "SIGNING"
  );
};

export const getAgreementResponseSignedState = (
  signingStatus?: string | null,
) => {
  const parsedStatus = SIGNING_STATUS_SCHEMA.safeParse(signingStatus);

  if (!parsedStatus.success) {
    return false;
  }

  return parsedStatus.data === "SIGNED" || parsedStatus.data === "COMPLETED";
};

export const normalizeSignerEmail = (email?: string | null) => {
  if (typeof email !== "string") {
    return null;
  }

  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizeSignerName = (name?: string | null) => {
  if (typeof name !== "string") {
    return null;
  }

  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const assertAgreementResponseSignerIdentity = ({
  agreementResponse,
  signerEmail,
  signerName,
  requireSignerEmail,
  requireSignerName,
}: {
  agreementResponse: {
    signerEmail: string | null;
    signerName: string | null;
  };
  signerEmail?: string | null;
  signerName?: string | null;
  requireSignerEmail?: boolean;
  requireSignerName?: boolean;
}) => {
  const submittedEmail = normalizeSignerEmail(signerEmail);
  const storedEmail = normalizeSignerEmail(agreementResponse.signerEmail);

  if (requireSignerEmail && !submittedEmail) {
    throw new TeamError(
      "Agreement signing could not be verified for this link.",
    );
  }

  if (storedEmail) {
    if (!submittedEmail || submittedEmail !== storedEmail) {
      throw new TeamError(
        "Agreement signing could not be verified for this link.",
      );
    }
  }

  const submittedName = normalizeSignerName(signerName);
  const storedName = normalizeSignerName(agreementResponse.signerName);

  if (requireSignerName && !submittedName) {
    throw new TeamError(
      "Agreement signing could not be verified for this link.",
    );
  }

  if (storedName && submittedName && submittedName !== storedName) {
    throw new TeamError(
      "Agreement signing could not be verified for this link.",
    );
  }
};

export const verifySigningWebhookSecret = (
  secret?: string | null,
): { ok: boolean; configured: boolean } => {
  const expectedSecret = getSigningWebhookSecret();

  if (!expectedSecret) {
    return { ok: false, configured: false };
  }

  if (!secret || secret.length !== expectedSecret.length) {
    return { ok: false, configured: true };
  }

  const ok = crypto.timingSafeEqual(
    Buffer.from(secret),
    Buffer.from(expectedSecret),
  );

  return { ok, configured: true };
};

export const SIGNING_TEMPLATE_VIEWER_RECIPIENT_NAME = "Viewer";

export const buildSigningTemplateViewerRecipient = () => ({
  email: "" as const,
  name: SIGNING_TEMPLATE_VIEWER_RECIPIENT_NAME,
  role: "SIGNER" as const,
  signingOrder: 1,
});

type SigningTemplateRecipient = {
  id: number;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  signingOrder?: number | null;
};

const isSigningTemplateViewerRecipient = (
  recipient: SigningTemplateRecipient,
) =>
  recipient.name === SIGNING_TEMPLATE_VIEWER_RECIPIENT_NAME &&
  recipient.role === "SIGNER";

const findSigningTemplateViewerRecipient = <
  T extends SigningTemplateRecipient,
>(
  recipients: T[],
) =>
  recipients.find(isSigningTemplateViewerRecipient) ??
  recipients.find((recipient) => recipient.role === "SIGNER") ??
  recipients[0];

const recipientNeedsViewerNormalization = (
  recipient: SigningTemplateRecipient,
) =>
  recipient.email !== "" ||
  recipient.name !== SIGNING_TEMPLATE_VIEWER_RECIPIENT_NAME ||
  recipient.role !== "SIGNER" ||
  recipient.signingOrder !== 1;

/** Reset the template recipient to the anonymous "Viewer" placeholder by its id (not a replacement) so existing fields stay attached. */
export const ensureSigningTemplateViewerRecipient = async ({
  envelopeId,
}: {
  envelopeId: string;
}) => {
  const signingClient = getSigningClient();
  const envelope = await getEnvelope(envelopeId);

  if (envelope.type !== "TEMPLATE") {
    throw new TeamError(
      "Signing envelopes must be templates before recipient setup can be checked.",
    );
  }

  const recipient = findSigningTemplateViewerRecipient(envelope.recipients);

  if (!recipient) {
    await signingClient.envelopes.recipients.createMany({
      envelopeId,
      data: [buildSigningTemplateViewerRecipient()],
    });
    return getEnvelope(envelopeId);
  }

  if (recipientNeedsViewerNormalization(recipient)) {
    await signingClient.envelopes.recipients.updateMany({
      envelopeId,
      data: [
        {
          id: recipient.id,
          ...buildSigningTemplateViewerRecipient(),
        },
      ],
    });
    return getEnvelope(envelopeId);
  }

  return envelope;
};

/** Create a Documenso template and seed the placeholder "Viewer" signer via the envelope side (email "" = Unknown enum); the direct link is minted later by `/signing/sync`. */
export const createSigningTemplateEnvelope = async ({
  title,
  externalId,
  file,
  folderId,
}: {
  title: string;
  externalId: string;
  file: {
    fileName: string;
    content: Uint8Array;
  };
  folderId?: string | null;
}) => {
  const signingClient = getSigningClient();

  const template = await signingClient.templates.create({
    payload: {
      title,
      externalId,
      folderId: folderId || undefined,
      meta: {
        subject: title,
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
    },
    file: {
      fileName: file.fileName,
      content: file.content,
    },
  });

  await signingClient.envelopes.recipients.createMany({
    envelopeId: template.envelopeId,
    data: [buildSigningTemplateViewerRecipient()],
  });

  return template;
};

const parseNumericTemplateId = (signingTemplateId: string) => {
  const parsed = SIGNING_TEMPLATE_ID_SCHEMA.safeParse(signingTemplateId);
  if (!parsed.success) {
    throw new TeamError(
      "The signing template id is invalid; please re-upload the agreement.",
    );
  }
  return parsed.data;
};

/** Idempotently ensure a template's direct link exists (re-enable or mint), keyed by the numeric `templateId` read from our DB since it isn't on the V2 envelope. */
export const ensureSigningTemplateDirectLink = async ({
  signingTemplateId,
}: {
  signingTemplateId: string;
}) => {
  const numericTemplateId = parseNumericTemplateId(signingTemplateId);
  const signingClient = getSigningClient();
  const template = await signingClient.templates.get({
    templateId: numericTemplateId,
  });

  if (template.directLink?.enabled && template.directLink.token) {
    return { template, directLink: template.directLink };
  }

  if (template.directLink?.token) {
    const directLink = await signingClient.templates.directLink.toggle({
      templateId: numericTemplateId,
      enabled: true,
    });
    return { template, directLink };
  }

  const signerRecipient = findSigningTemplateViewerRecipient(
    template.recipients,
  );
  if (!signerRecipient) {
    throw new TeamError(
      "The signing template must include at least one recipient before a direct link can be created.",
    );
  }

  try {
    const directLink = await signingClient.templates.directLink.create({
      templateId: numericTemplateId,
      directRecipientId: signerRecipient.id,
    });
    return { template, directLink };
  } catch (error) {
    console.error(
      "[signing] templates.directLink.create failed",
      {
        templateId: numericTemplateId,
        directRecipientId: signerRecipient.id,
      },
      error,
    );
    throw error;
  }
};

/** Delete (not just toggle off) the direct link so the V2 field editor doesn't fail on "direct template exists"; `/signing/sync` recreates it after save. */
export const deleteSigningTemplateDirectLink = async ({
  signingTemplateId,
}: {
  signingTemplateId: string;
}) => {
  const numericTemplateId = parseNumericTemplateId(signingTemplateId);
  const signingClient = getSigningClient();
  const template = await signingClient.templates.get({
    templateId: numericTemplateId,
  });

  if (!template.directLink) {
    return { template, directLink: template.directLink ?? null };
  }

  const directLink = await signingClient.templates.directLink.delete({
    templateId: numericTemplateId,
  });

  return { template, directLink };
};

const DEFAULT_SIGNING_FOLDER_NAME = "Papermark";

const buildTeamSigningFolderTag = (teamId: string) =>
  `papermark:team:${teamId}`;

export const buildTeamSigningFolderName = ({
  name,
  id,
}: {
  name?: string | null;
  id: string;
}) => {
  const trimmedName = name?.trim();
  const tag = buildTeamSigningFolderTag(id);
  const prefix =
    trimmedName && trimmedName.length > 0
      ? trimmedName
      : DEFAULT_SIGNING_FOLDER_NAME;

  return `${prefix} [${tag}]`;
};

const folderHasTeamTag = (folderName: string, teamId: string) =>
  folderName.includes(`[${buildTeamSigningFolderTag(teamId)}]`);

const findTeamSigningFolderId = async ({
  teamId,
  type,
}: {
  teamId: string;
  type: "TEMPLATE" | "DOCUMENT";
}) => {
  const signingClient = getSigningClient();
  const tag = buildTeamSigningFolderTag(teamId);

  let currentPage = 1;
  let totalPages = 1;

  while (currentPage <= totalPages) {
    const folders = await signingClient.folders.find({
      query: tag,
      type,
      page: currentPage,
      perPage: 100,
    });

    const match = folders.data.find((folder) =>
      folderHasTeamTag(folder.name, teamId),
    );

    if (match) {
      return match.id;
    }

    totalPages = folders.totalPages;
    currentPage += 1;
  }

  return null;
};

const ensureTeamSigningFolderByType = async ({
  team,
  type,
}: {
  team: { id: string; name?: string | null };
  type: "TEMPLATE" | "DOCUMENT";
}) => {
  const existingFolderId = await findTeamSigningFolderId({
    teamId: team.id,
    type,
  });

  if (existingFolderId) {
    return existingFolderId;
  }

  const signingClient = getSigningClient();
  const folder = await signingClient.folders.create({
    name: buildTeamSigningFolderName({ name: team.name, id: team.id }),
    type,
  });

  return folder.id;
};

type TeamSigningFolders = {
  templateFolderId: string;
  documentFolderId: string;
};

const TEAM_SIGNING_FOLDER_CACHE_TTL_MS = 5 * 60 * 1000;

const teamSigningFolderCache = new Map<
  string,
  { folders: TeamSigningFolders; expiresAt: number }
>();

export const ensureTeamSigningFolders = async (
  teamId: string,
): Promise<TeamSigningFolders> => {
  const cached = teamSigningFolderCache.get(teamId);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.folders;
  }

  const team = await prisma.team.findUnique({
    where: {
      id: teamId,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!team) {
    throw new TeamError("Team not found while preparing signing folders.");
  }

  const [templateFolderId, documentFolderId] = await Promise.all([
    ensureTeamSigningFolderByType({ team, type: "TEMPLATE" }),
    ensureTeamSigningFolderByType({ team, type: "DOCUMENT" }),
  ]);

  const folders: TeamSigningFolders = {
    templateFolderId,
    documentFolderId,
  };

  teamSigningFolderCache.set(teamId, {
    folders,
    expiresAt: Date.now() + TEAM_SIGNING_FOLDER_CACHE_TTL_MS,
  });

  return folders;
};

/** Resolve an agreement's direct-link token, keyed by the numeric `templateId` from our DB (the envelope only carries it for DOCUMENT envelopes). */
export const getAgreementSigningToken = async ({
  signingTemplateId,
}: {
  signingTemplateId: string;
}) => {
  const { template, directLink } = await ensureSigningTemplateDirectLink({
    signingTemplateId,
  });

  return {
    token: directLink.token,
    templateId: String(template.id),
    directLinkId: directLink.id,
  };
};

export type SigningDocumentSession = {
  documentId: number;
  envelopeId: string;
  recipientId: number;
  token: string;
};

/** Mint a per-visitor document via `templates.use` (EmbedSignDocument) so fields render inline; `distributionMethod: "NONE"` sends no email and `externalId` ties it back to the AgreementResponse. */
export const createSigningDocumentFromTemplate = async ({
  signingTemplateId,
  externalId,
  signerEmail,
  signerName,
}: {
  signingTemplateId: string;
  externalId: string;
  signerEmail?: string | null;
  signerName?: string | null;
}): Promise<SigningDocumentSession> => {
  const numericTemplateId = parseNumericTemplateId(signingTemplateId);
  const signingClient = getSigningClient();

  // Fields are drawn against the single "Viewer" recipient seeded at setup
  // time; `templates.use` maps this visitor onto that placeholder by its id.
  const template = await signingClient.templates.get({
    templateId: numericTemplateId,
  });

  const viewerRecipient = findSigningTemplateViewerRecipient(
    template.recipients,
  );
  if (!viewerRecipient) {
    throw new TeamError(
      "The signing template has no recipient to assign the signer to.",
    );
  }

  const document = await signingClient.templates.use({
    templateId: numericTemplateId,
    externalId,
    distributeDocument: true,
    recipients: [
      {
        id: viewerRecipient.id,
        email: normalizeSignerEmail(signerEmail) ?? "",
        name: normalizeSignerName(signerName) ?? undefined,
      },
    ],
    override: {
      distributionMethod: "NONE",
    },
  });

  const recipient =
    document.recipients.find((item) => item.token) ?? document.recipients[0];

  if (!recipient?.token) {
    throw new TeamError(
      "Documenso did not return a signing token for the created document.",
    );
  }

  return {
    documentId: document.id,
    envelopeId: document.envelopeId,
    recipientId: recipient.id,
    token: recipient.token,
  };
};

/** Re-fetch the token for an existing per-visitor document so re-opening reuses it instead of spawning a new one; returns null when it's no longer signable. */
export const getReusableSigningDocumentSession = async ({
  documentId,
}: {
  documentId: number;
}): Promise<SigningDocumentSession | null> => {
  const signingClient = getSigningClient();

  try {
    const document = await signingClient.documents.get({ documentId });

    if (document.status === "COMPLETED" || document.status === "REJECTED") {
      return null;
    }

    const recipient =
      document.recipients.find((item) => item.token) ?? document.recipients[0];

    if (!recipient?.token) {
      return null;
    }

    return {
      documentId,
      envelopeId: recipient.envelopeId,
      recipientId: recipient.id,
      token: recipient.token,
    };
  } catch (error) {
    console.error("[signing] failed to reuse signing document", {
      documentId,
      error,
    });
    return null;
  }
};

/** Resolve a signable document session: reuse the response's pending document when possible, otherwise create one from the template. */
export const ensureSigningDocumentSession = async ({
  signingTemplateId,
  externalId,
  existingDocumentId,
  signerEmail,
  signerName,
}: {
  signingTemplateId: string;
  externalId: string;
  existingDocumentId?: number | null;
  signerEmail?: string | null;
  signerName?: string | null;
}): Promise<SigningDocumentSession> => {
  if (existingDocumentId) {
    const reused = await getReusableSigningDocumentSession({
      documentId: existingDocumentId,
    });

    if (reused) {
      return reused;
    }
  }

  return createSigningDocumentFromTemplate({
    signingTemplateId,
    externalId,
    signerEmail,
    signerName,
  });
};

export const getSignedDocumentDetails = async (documentId: number) => {
  const signingClient = getSigningClient();
  const document = await signingClient.documents.get({ documentId });

  const signedRecipient =
    document.recipients.find(
      (recipient) => recipient.signingStatus === "SIGNED",
    ) || document.recipients[0];

  return {
    document,
    signedRecipient,
  };
};

const moveSigningDocumentToTeamFolder = async ({
  documentId,
  currentFolderId,
  teamId,
}: {
  documentId: number;
  currentFolderId: string | null | undefined;
  teamId: string;
}) => {
  try {
    const { documentFolderId } = await ensureTeamSigningFolders(teamId);

    if (!documentFolderId || currentFolderId === documentFolderId) {
      return;
    }

    const signingClient = getSigningClient();

    await signingClient.documents.update({
      documentId,
      data: {
        folderId: documentFolderId,
      },
    });
  } catch (error) {
    // Folder placement is best-effort: never block status sync on it.
    console.error(
      "[signing] Failed to move signed document into the team folder.",
      error,
    );
  }
};

export const syncAgreementResponseWithSigningDocument = async ({
  agreementResponseId,
  documentId,
  signingStatus,
}: {
  agreementResponseId: string;
  documentId: number;
  signingStatus?: SigningStatus;
}) => {
  // Callers of `/signing/complete` are unauthenticated, so enforce the
  // document <-> response binding below (these reads are independent, run in parallel).
  const [existingResponse, signedDetails] = await Promise.all([
    prisma.agreementResponse.findUnique({
      where: { id: agreementResponseId },
      select: {
        id: true,
        signingExternalId: true,
        signingStatus: true,
        agreement: {
          select: {
            id: true,
            teamId: true,
            signingEnvelopeId: true,
            signingTemplateId: true,
          },
        },
      },
    }),
    getSignedDocumentDetails(documentId),
  ]);

  if (!existingResponse) {
    throw new TeamError("Agreement signing session was not found.");
  }

  const { document, signedRecipient } = signedDetails;

  // Document <-> session binding: the document must carry the externalId we
  // minted for this response, and it must belong to the agreement template.
  if (
    !existingResponse.signingExternalId ||
    document.externalId !== existingResponse.signingExternalId
  ) {
    throw new TeamError(
      "Signed document does not belong to this signing session.",
    );
  }

  // Signing spawns a new DOCUMENT envelope, so template membership is verified
  // via `document.templateId === agreement.signingTemplateId`, not envelopeId.
  if (existingResponse.agreement?.signingTemplateId) {
    const parsedTemplateId = SIGNING_TEMPLATE_ID_SCHEMA.safeParse(
      existingResponse.agreement.signingTemplateId,
    );

    if (
      parsedTemplateId.success &&
      document.templateId &&
      document.templateId !== parsedTemplateId.data
    ) {
      throw new TeamError(
        "Signed document does not belong to this agreement template.",
      );
    }
  }

  const recipientEmail = signedRecipient?.email?.trim();
  const recipientName = signedRecipient?.name?.trim();

  const agreementResponse = await prisma.agreementResponse.update({
    where: {
      id: agreementResponseId,
    },
    data: {
      signingStatus:
        signingStatus || (document.completedAt ? "COMPLETED" : "SIGNED"),
      signingEnvelopeId: document.envelopeId,
      // Persist the numeric documentId so each download is a single keyed Documenso call.
      signingDocumentId: documentId,
      signedAt: signedRecipient?.signedAt
        ? new Date(signedRecipient.signedAt)
        : null,
      completedAt: document.completedAt ? new Date(document.completedAt) : null,
      // Overwrite the seeded identity with the provider's authoritative value, but only when present so we don't clobber it with an empty string.
      ...(recipientEmail ? { signerEmail: recipientEmail } : {}),
      ...(recipientName ? { signerName: recipientName } : {}),
    },
    include: {
      agreement: {
        select: {
          teamId: true,
        },
      },
    },
  });

  // Best-effort folder move via `waitUntil` so it survives past the response on serverless runtimes that freeze after responding.
  if (agreementResponse.agreement?.teamId) {
    waitUntil(
      moveSigningDocumentToTeamFolder({
        documentId,
        currentFolderId: document.folderId,
        teamId: agreementResponse.agreement.teamId,
      }).catch((error) => {
        console.error("[signing] background folder move failed", error);
      }),
    );
  }

  return agreementResponse;
};

export const findAgreementResponseByExternalId = async (
  signingExternalId: string,
) => {
  return prisma.agreementResponse.findUnique({
    where: {
      signingExternalId,
    },
    include: {
      agreement: {
        select: {
          id: true,
          teamId: true,
          signingProvider: true,
        },
      },
    },
  });
};

export const getAgreementResponseForAccess = async ({
  agreementResponseId,
  agreementId,
  linkId,
  signerEmail,
  signerName,
  requireSignerEmail,
  requireSignerName,
  skipSignerIdentityCheck,
}: {
  agreementResponseId?: string | null;
  agreementId?: string | null;
  linkId?: string | null;
  signerEmail?: string | null;
  signerName?: string | null;
  requireSignerEmail?: boolean;
  requireSignerName?: boolean;
  // Set when an HMAC-bound cookie (`pm_sas_{linkId}`) already proves browser ownership — stronger than an email/name match.
  skipSignerIdentityCheck?: boolean;
}) => {
  if (!agreementResponseId || !agreementId) {
    throw new TeamError("Agreement signing is required before continuing.");
  }

  const agreementResponse = await prisma.agreementResponse.findUnique({
    where: {
      id: agreementResponseId,
    },
  });

  if (!agreementResponse || agreementResponse.agreementId !== agreementId) {
    throw new TeamError(
      "Agreement signing could not be verified for this link.",
    );
  }

  // C3: prevent replaying a response against a different link reusing the same agreement (legacy rows without a linkId fall through).
  if (
    linkId &&
    agreementResponse.linkId &&
    agreementResponse.linkId !== linkId
  ) {
    throw new TeamError(
      "Agreement signing could not be verified for this link.",
    );
  }

  if (!getAgreementResponseSignedState(agreementResponse.signingStatus)) {
    throw new TeamError(
      "Agreement signing is still pending. Please finish signing to continue.",
    );
  }

  if (!skipSignerIdentityCheck) {
    assertAgreementResponseSignerIdentity({
      agreementResponse,
      signerEmail,
      signerName,
      requireSignerEmail,
      requireSignerName,
    });
  }

  return agreementResponse;
};

export const getSignedAgreementResponseForViewer = async ({
  agreementResponseId,
  agreementId,
  linkId,
}: {
  agreementResponseId: string;
  agreementId: string;
  linkId: string;
}) => {
  const agreementResponse = await prisma.agreementResponse.findUnique({
    where: {
      id: agreementResponseId,
    },
    select: {
      id: true,
      agreementId: true,
      linkId: true,
      signerEmail: true,
      signerName: true,
      signingStatus: true,
    },
  });

  if (
    !agreementResponse ||
    agreementResponse.agreementId !== agreementId ||
    agreementResponse.linkId !== linkId ||
    !getAgreementResponseSignedState(agreementResponse.signingStatus)
  ) {
    return null;
  }

  return agreementResponse;
};

/** Resolve the response gating access: SIGNING agreements need a pre-created SIGNED/COMPLETED response; legacy checkbox agreements get a SIGNED response created inline. */
export const ensureAgreementResponseForAccess = async ({
  agreement,
  linkId,
  agreementResponseId,
  hasConfirmedAgreement,
  signerEmail,
  signerName,
  requireSignerEmail,
  requireSignerName,
  skipSignerIdentityCheck,
}: {
  agreement: {
    id: string;
    signingProvider?: string | null;
    contentType?: string | null;
    requireName?: boolean | null;
  };
  linkId: string;
  agreementResponseId?: string | null;
  hasConfirmedAgreement?: boolean | null;
  signerEmail?: string | null;
  signerName?: string | null;
  requireSignerEmail?: boolean;
  requireSignerName?: boolean;
  skipSignerIdentityCheck?: boolean;
}) => {
  if (isSigningAgreement(agreement)) {
    return getAgreementResponseForAccess({
      agreementResponseId,
      agreementId: agreement.id,
      linkId,
      signerEmail,
      signerName,
      requireSignerEmail,
      requireSignerName:
        requireSignerName ?? agreement.requireName ?? undefined,
      skipSignerIdentityCheck,
    });
  }

  if (!hasConfirmedAgreement) {
    throw new TeamError("Agreement to NDA is required.");
  }

  const trimmedEmail =
    typeof signerEmail === "string" && signerEmail.trim().length > 0
      ? signerEmail.trim()
      : null;
  const trimmedName =
    typeof signerName === "string" && signerName.trim().length > 0
      ? signerName.trim()
      : null;

  const now = new Date();

  return prisma.agreementResponse.create({
    data: {
      agreementId: agreement.id,
      linkId,
      signerEmail: trimmedEmail,
      signerName: trimmedName,
      signingStatus: "SIGNED",
      signedAt: now,
      completedAt: now,
    },
  });
};

export const getSigningAgreementCreateData = ({
  teamId,
  name,
  content,
  contentType,
  requireName,
}: {
  teamId: string;
  name: string;
  content?: string;
  contentType: "LINK" | "TEXT" | "SIGNING";
  requireName: boolean;
}): Prisma.AgreementCreateInput => {
  const trimmedName = name.trim();

  if (contentType === "SIGNING") {
    return {
      team: {
        connect: {
          id: teamId,
        },
      },
      name: trimmedName,
      content:
        content?.trim() ||
        `Embedded signing flow for ${trimmedName}. This agreement is managed in Papermark.`,
      contentType,
      signingProvider: "DOCUMENSO",
      requireName,
    };
  }

  return {
    team: {
      connect: {
        id: teamId,
      },
    },
    name: trimmedName,
    content: content?.trim() || "",
    contentType,
    signingProvider: "LEGACY",
    requireName,
  };
};

export const getSigningEmbedConfig = () => {
  return {
    host: getSigningHost(),
  };
};
