import { NextApiRequest, NextApiResponse } from "next";

import { parse as parseCookieHeader } from "cookie";
import { z } from "zod";

import { TeamError, errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import {
  buildSignedAgreementAccessCookie,
  getSignedAgreementAccessCookieName,
  mintSignedAgreementAccessToken,
  parseSignedAgreementAccessToken,
  verifySignedAgreementAccessToken,
} from "@/lib/signing/access-token";
import {
  buildAgreementResponseSigningExternalId,
  getAgreementResponseSignedState,
  getAgreementSigningToken,
  getSigningEmbedConfig,
  isSigningAgreement,
} from "@/lib/signing/agreements";
import {
  SIGNED_DOWNLOAD_COOKIE_NAME,
  buildSignedAgreementDownloadCookie,
  mintSignedAgreementDownloadToken,
  verifySignedAgreementDownloadToken,
} from "@/lib/signing/download-token";
import { getIpAddress } from "@/lib/utils/ip";

const optionalEmailSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmedValue = value.trim().toLowerCase();

  return trimmedValue.length > 0 ? trimmedValue : null;
}, z.string().email().nullable().optional());

const optionalNameSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : null;
}, z.string().max(255).nullable().optional());

const createSigningSessionSchema = z.object({
  agreementId: z.string().min(1, "Agreement ID is required."),
  linkId: z.string().min(1, "Link ID is required."),
  email: optionalEmailSchema,
  name: optionalNameSchema,
  agreementResponseId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
});

const resolveContinuityAgreementResponseId = ({
  linkId,
  agreementId,
  cookies,
  requestedAgreementResponseId,
}: {
  linkId: string;
  agreementId: string;
  cookies: Record<string, string | undefined>;
  requestedAgreementResponseId?: string;
}): string | null => {
  const accessCookie = cookies[getSignedAgreementAccessCookieName(linkId)];
  const accessPayload = parseSignedAgreementAccessToken(accessCookie);
  const downloadToken = cookies[SIGNED_DOWNLOAD_COOKIE_NAME];

  const accessResponseId =
    accessPayload &&
    accessPayload.linkId === linkId &&
    accessPayload.agreementId === agreementId
      ? accessPayload.agreementResponseId
      : null;

  const downloadResponseId =
    requestedAgreementResponseId &&
    verifySignedAgreementDownloadToken(downloadToken, {
      agreementResponseId: requestedAgreementResponseId,
      linkId,
    })
      ? requestedAgreementResponseId
      : null;

  if (accessResponseId && downloadResponseId) {
    return accessResponseId === downloadResponseId ? accessResponseId : null;
  }

  if (accessResponseId) {
    return accessResponseId;
  }

  if (downloadResponseId) {
    return downloadResponseId;
  }

  if (
    requestedAgreementResponseId &&
    verifySignedAgreementAccessToken(accessCookie, {
      linkId,
      agreementId,
      agreementResponseId: requestedAgreementResponseId,
    })
  ) {
    return requestedAgreementResponseId;
  }

  return null;
};

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const parseResult = createSigningSessionSchema.safeParse(req.body);

    if (!parseResult.success) {
      throw new TeamError("A valid agreement signing request is required.");
    }

    const { agreementId, linkId, email, name, agreementResponseId } =
      parseResult.data;

    const ipAddressValue = getIpAddress(req.headers);
    // Run the independent rate-limit checks and agreement read in parallel; we still bail on a 429 before further work.
    const [linkLimit, ipLimit, agreement] = await Promise.all([
      ratelimit(100, "1 m").limit(`signing-session:${linkId}`),
      ratelimit(20, "1 m").limit(`signing-session:ip:${ipAddressValue}`),
      prisma.agreement.findFirst({
        where: {
          id: agreementId,
          deletedAt: null,
          links: {
            some: {
              id: linkId,
              deletedAt: null,
              enableAgreement: true,
            },
          },
        },
        select: {
          id: true,
          teamId: true,
          signingProvider: true,
          contentType: true,
          signingEnvelopeId: true,
          signingTemplateId: true,
          signingExternalId: true,
        },
      }),
    ]);

    if (!linkLimit.success || !ipLimit.success) {
      return res.status(429).json({
        message: "Too many signing requests. Please try again in a minute.",
      });
    }

    if (!agreement) {
      throw new TeamError("Agreement signing is not available for this link.");
    }

    if (!isSigningAgreement(agreement)) {
      throw new TeamError("This agreement does not support embedded signing.");
    }

    if (!agreement.signingEnvelopeId || !agreement.signingTemplateId) {
      throw new TeamError(
        "This agreement has not finished syncing with the signing provider yet.",
      );
    }

    const cookies = parseCookieHeader(req.headers.cookie || "");
    const continuityAgreementResponseId = resolveContinuityAgreementResponseId({
      linkId,
      agreementId,
      cookies,
      requestedAgreementResponseId: agreementResponseId,
    });

    if (continuityAgreementResponseId) {
      const existingResponse = await prisma.agreementResponse.findUnique({
        where: {
          id: continuityAgreementResponseId,
        },
        select: {
          id: true,
          agreementId: true,
          linkId: true,
          signingStatus: true,
          signingExternalId: true,
        },
      });

      if (
        existingResponse &&
        existingResponse.agreementId === agreementId &&
        existingResponse.linkId === linkId
      ) {
        if (getAgreementResponseSignedState(existingResponse.signingStatus)) {
          const accessCookie = mintSignedAgreementAccessToken({
            agreementResponseId: existingResponse.id,
            linkId,
            agreementId,
          });

          res.setHeader("Set-Cookie", [
            buildSignedAgreementAccessCookie({
              linkId,
              token: accessCookie.token,
              maxAgeSeconds: accessCookie.maxAgeSeconds,
              secure: process.env.NODE_ENV === "production",
            }),
          ]);

          return res.status(200).json({
            alreadySigned: true,
            agreementResponseId: existingResponse.id,
            signingStatus: existingResponse.signingStatus,
          });
        }

        if (!existingResponse.signingExternalId) {
          throw new TeamError(
            "Signing session is missing its external identifier.",
          );
        }

        // Direct-link signing: Documenso mints the per-visitor document at completion (stamped with this response's externalId so `/signing/complete` can bind it back), so we only persist the access-form identity here when provided.
        if (email || name) {
          await prisma.agreementResponse.update({
            where: {
              id: existingResponse.id,
            },
            data: {
              ...(email ? { signerEmail: email } : {}),
              ...(name ? { signerName: name } : {}),
            },
          });
        }

        const { token } = await getAgreementSigningToken({
          signingTemplateId: agreement.signingTemplateId,
        });

        const downloadCookie = mintSignedAgreementDownloadToken({
          agreementResponseId: existingResponse.id,
          linkId,
        });

        res.setHeader("Set-Cookie", [
          buildSignedAgreementDownloadCookie({
            token: downloadCookie.token,
            maxAgeSeconds: downloadCookie.maxAgeSeconds,
            secure: process.env.NODE_ENV === "production",
          }),
        ]);

        return res.status(200).json({
          agreementResponseId: existingResponse.id,
          externalId: existingResponse.signingExternalId,
          token,
          ...getSigningEmbedConfig(),
        });
      }
    }

    const updatedAgreementResponse = await prisma.$transaction(async (tx) => {
      const created = await tx.agreementResponse.create({
        data: {
          agreementId: agreement.id,
          linkId,
          signerEmail: email ?? null,
          signerName: name ?? null,
        },
      });

      const externalId = buildAgreementResponseSigningExternalId(
        agreement.teamId,
        created.id,
      );

      return tx.agreementResponse.update({
        where: {
          id: created.id,
        },
        data: {
          signingExternalId: externalId,
        },
        select: {
          id: true,
          signingExternalId: true,
        },
      });
    });

    if (!updatedAgreementResponse.signingExternalId) {
      throw new TeamError("Failed to initialize the signing session.");
    }

    // Direct-link signing: resolve the template's shared direct-link token; Documenso creates the per-visitor document lazily at completion (stamped with this response's externalId) so `/signing/complete` can bind it back.
    const { token } = await getAgreementSigningToken({
      signingTemplateId: agreement.signingTemplateId,
    });

    const downloadCookie = mintSignedAgreementDownloadToken({
      agreementResponseId: updatedAgreementResponse.id,
      linkId,
    });
    res.setHeader("Set-Cookie", [
      buildSignedAgreementDownloadCookie({
        token: downloadCookie.token,
        maxAgeSeconds: downloadCookie.maxAgeSeconds,
        secure: process.env.NODE_ENV === "production",
      }),
    ]);

    return res.status(200).json({
      agreementResponseId: updatedAgreementResponse.id,
      externalId: updatedAgreementResponse.signingExternalId,
      token,
      ...getSigningEmbedConfig(),
    });
  } catch (error) {
    return errorhandler(error, res);
  }
}
