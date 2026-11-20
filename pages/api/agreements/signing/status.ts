import { NextApiRequest, NextApiResponse } from "next";

import { parse as parseCookieHeader } from "cookie";
import { z } from "zod";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import {
  getSignedAgreementAccessCookieName,
  parseSignedAgreementAccessToken,
} from "@/lib/signing/access-token";
import { getSignedAgreementResponseForViewer } from "@/lib/signing/agreements";
import {
  SIGNED_DOWNLOAD_COOKIE_NAME,
  verifySignedAgreementDownloadToken,
} from "@/lib/signing/download-token";
import { getIpAddress } from "@/lib/utils/ip";

const signingStatusQuerySchema = z.object({
  linkId: z.string().min(1, "Link ID is required."),
  agreementId: z.string().min(1, "Agreement ID is required."),
  agreementResponseId: z.string().min(1).optional(),
});

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const parseResult = signingStatusQuerySchema.safeParse(req.query);

    if (!parseResult.success) {
      return res.status(200).json({ signed: false });
    }

    const { linkId, agreementId, agreementResponseId } = parseResult.data;

    const ipAddressValue = getIpAddress(req.headers);
    const ipLimit = await ratelimit(30, "1 m").limit(
      `signing-status:ip:${ipAddressValue}`,
    );

    if (!ipLimit.success) {
      return res.status(429).json({
        message: "Too many requests. Please try again in a minute.",
      });
    }

    const linkHasAgreement = await prisma.link.findFirst({
      where: {
        id: linkId,
        deletedAt: null,
        enableAgreement: true,
        agreementId,
      },
      select: {
        id: true,
      },
    });

    if (!linkHasAgreement) {
      return res.status(200).json({ signed: false });
    }

    const cookies = parseCookieHeader(req.headers.cookie || "");
    const accessCookie = cookies[getSignedAgreementAccessCookieName(linkId)];
    const accessPayload = parseSignedAgreementAccessToken(accessCookie);
    const signedAccessAgreementResponseId =
      accessPayload &&
      accessPayload.linkId === linkId &&
      accessPayload.agreementId === agreementId
        ? accessPayload.agreementResponseId
        : null;
    let resolvedAgreementResponseId: string | null = null;

    if (signedAccessAgreementResponseId) {
      resolvedAgreementResponseId = signedAccessAgreementResponseId;
    } else if (agreementResponseId) {
      // Honor the hint only with proof of an active signing session (the `pm_sds` cookie); never trust a localStorage hint alone, or a leaked `agreementResponseId` could claim the signed state.
      const downloadToken = cookies[SIGNED_DOWNLOAD_COOKIE_NAME];
      const hasPendingSessionProof = verifySignedAgreementDownloadToken(
        downloadToken,
        {
          agreementResponseId,
          linkId,
        },
      );

      if (hasPendingSessionProof) {
        resolvedAgreementResponseId = agreementResponseId;
      }
    }

    if (!resolvedAgreementResponseId) {
      return res.status(200).json({ signed: false });
    }

    const signedResponse = await getSignedAgreementResponseForViewer({
      agreementResponseId: resolvedAgreementResponseId,
      agreementId,
      linkId,
    });

    if (!signedResponse) {
      return res.status(200).json({ signed: false });
    }

    const canReturnSignerIdentity =
      signedAccessAgreementResponseId === signedResponse.id;

    const response = {
      signed: true,
      agreementResponseId: signedResponse.id,
      signingStatus: signedResponse.signingStatus,
      // Only echo signer identity to the browser holding the post-signing access cookie; the session/download proof can restore signed state but not private identity.
      signerEmail: canReturnSignerIdentity
        ? signedResponse.signerEmail
        : undefined,
      signerName: canReturnSignerIdentity
        ? signedResponse.signerName
        : undefined,
    };

    return res.status(200).json(response);
  } catch (error) {
    return errorhandler(error, res);
  }
}
