import { NextApiRequest, NextApiResponse } from "next";

import { waitUntil } from "@vercel/functions";
import { parse as parseCookieHeader } from "cookie";

import { getDataroomSessionByLinkIdInPagesRouter } from "@/lib/auth/dataroom-auth";
import { verifyLinkSessionInPagesRouter } from "@/lib/auth/link-session";
import { TeamError, errorhandler } from "@/lib/errorHandler";
import { getFile } from "@/lib/files/get-file";
import prisma from "@/lib/prisma";
import { getAgreementResponseSignedState } from "@/lib/signing/agreements";
import { getEnvelopeSignedDownloadUrl } from "@/lib/signing/envelopes";
import { mirrorSignedAgreementToStorage } from "@/lib/signing/mirror";
import {
  getSignedAgreementAccessCookieName,
  verifySignedAgreementAccessToken,
} from "@/lib/signing/access-token";
import {
  SIGNED_DOWNLOAD_COOKIE_NAME,
  verifySignedAgreementDownloadToken,
} from "@/lib/signing/download-token";
import { buildContentDisposition } from "@/lib/utils";

// `waitUntil` requires response streaming to be enabled on Pages API routes.
export const config = {
  supportsResponseStreaming: true,
};

// Clamp to Documenso's 50MB upload cap to bound memory and avoid OOM on the fallback path.
const MAX_SIGNED_PDF_BYTES = 50 * 1024 * 1024;

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { agreementResponseId } = req.query as {
      agreementResponseId: string;
    };

    const agreementResponse = await prisma.agreementResponse.findUnique({
      where: {
        id: agreementResponseId,
      },
      select: {
        id: true,
        linkId: true,
        signerEmail: true,
        signingStatus: true,
        signingExternalId: true,
        signingEnvelopeId: true,
        signingDocumentId: true,
        signedFileKey: true,
        signedFileName: true,
        signedFileStorageType: true,
        agreement: {
          select: {
            name: true,
            teamId: true,
            id: true,
          },
        },
      },
    });

    if (!agreementResponse) {
      throw new TeamError("Signed agreement was not found.");
    }

    if (!getAgreementResponseSignedState(agreementResponse.signingStatus)) {
      throw new TeamError("Signed agreement is not ready yet.");
    }

    // C2: this unauthenticated endpoint requires a binding proof tied to this `linkId` (link/dataroom session cookie or the `pm_sds` signing-session cookie); otherwise anyone who learns an `agreementResponseId` could stream the signed PDF.
    if (!agreementResponse.linkId) {
      throw new TeamError("Signed agreement is not tied to a visitor link.");
    }

    const [linkSession, dataroomSession] = await Promise.all([
      verifyLinkSessionInPagesRouter(req, agreementResponse.linkId),
      getDataroomSessionByLinkIdInPagesRouter(req, agreementResponse.linkId),
    ]);

    let authorized = !!linkSession || !!dataroomSession;

    if (!authorized) {
      const downloadToken =
        parseCookieHeader(req.headers.cookie || "")[
          SIGNED_DOWNLOAD_COOKIE_NAME
        ];
      authorized = verifySignedAgreementDownloadToken(downloadToken, {
        agreementResponseId: agreementResponse.id,
        linkId: agreementResponse.linkId,
      });
    }

    if (!authorized) {
      const accessToken =
        parseCookieHeader(req.headers.cookie || "")[
          getSignedAgreementAccessCookieName(agreementResponse.linkId)
        ];
      authorized = verifySignedAgreementAccessToken(accessToken, {
        linkId: agreementResponse.linkId,
        agreementId: agreementResponse.agreement.id,
        agreementResponseId: agreementResponse.id,
      });
    }

    if (!authorized) {
      return res.status(401).end("Unauthorized");
    }

    // Defense-in-depth: when the link session carries an email, require it to match the signer (other proofs rely on the linkId/responseId binding above).
    const sessionEmail = linkSession?.email ?? null;
    if (
      agreementResponse.signerEmail &&
      sessionEmail &&
      sessionEmail.toLowerCase() !==
        agreementResponse.signerEmail.toLowerCase()
    ) {
      return res.status(403).end("Forbidden");
    }

    const safeName =
      agreementResponse.agreement.name
        .replace(/[^a-z0-9\-_]/gi, "_")
        .toLowerCase()
        .substring(0, 50) || "agreement";
    const fallbackName = `${safeName}_signed.pdf`;

    // Fast path: mirror is ready, serve from our own storage with a 302.
    if (
      agreementResponse.signedFileKey &&
      agreementResponse.signedFileStorageType
    ) {
      const filename = agreementResponse.signedFileName || fallbackName;
      const url = await getFile({
        type: agreementResponse.signedFileStorageType,
        data: agreementResponse.signedFileKey,
        isDownload: true,
        responseContentDisposition: buildContentDisposition(
          filename,
          fallbackName,
        ),
      });
      return res.redirect(302, url);
    }

    if (!agreementResponse.signingEnvelopeId) {
      throw new TeamError("Signed agreement envelope could not be found.");
    }

    // Fallback path: mint a download URL keyed by envelopeId/documentId (no paginated scan or folder lookup).
    const { url: downloadUrl } = await getEnvelopeSignedDownloadUrl({
      envelopeId: agreementResponse.signingEnvelopeId,
      documentId: agreementResponse.signingDocumentId,
    });

    // Kick off a background mirror so the next click is served from storage; `waitUntil` keeps the function alive past the response without blocking the user.
    waitUntil(
      mirrorSignedAgreementToStorage({
        agreementResponseId: agreementResponse.id,
      }).catch((error) => {
        console.error(
          "[signing] background mirror during download fallback failed",
          error,
        );
      }),
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let fileResponse: Response;
    try {
      fileResponse = await fetch(downloadUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!fileResponse.ok) {
      throw new TeamError("Failed to fetch the signed agreement file.");
    }

    // H5: enforce a hard cap — check the upstream Content-Length first and refuse oversized responses before allocating memory.
    const contentLengthHeader = fileResponse.headers.get("content-length");
    if (contentLengthHeader) {
      const advertised = Number.parseInt(contentLengthHeader, 10);
      if (
        Number.isFinite(advertised) &&
        advertised > MAX_SIGNED_PDF_BYTES
      ) {
        throw new TeamError("Signed agreement file is too large to download.");
      }
    }

    const buffer = await readResponseBodyWithCap(
      fileResponse,
      MAX_SIGNED_PDF_BYTES,
    );

    res.setHeader(
      "Content-Type",
      fileResponse.headers.get("content-type") || "application/pdf",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      buildContentDisposition(fallbackName, fallbackName),
    );
    res.setHeader("Content-Length", buffer.byteLength.toString());
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(buffer);
  } catch (error) {
    return errorhandler(error, res);
  }
}

async function readResponseBodyWithCap(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  if (!response.body) {
    const fallback = await response.arrayBuffer();
    if (fallback.byteLength > maxBytes) {
      throw new TeamError("Signed agreement file is too large to download.");
    }
    return Buffer.from(fallback);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore cancel failures
      }
      throw new TeamError("Signed agreement file is too large to download.");
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
}
