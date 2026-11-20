import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import { TeamError, errorhandler } from "@/lib/errorHandler";
import { getFile } from "@/lib/files/get-file";
import prisma from "@/lib/prisma";
import { getAgreementResponseSignedState } from "@/lib/signing/agreements";
import { getEnvelopeSignedDownloadUrl } from "@/lib/signing/envelopes";
import { mirrorSignedAgreementToStorage } from "@/lib/signing/mirror";
import { buildContentDisposition } from "@/lib/utils";
import { CustomUser } from "@/lib/types";

// `waitUntil` requires response streaming to be enabled on Pages API routes.
export const config = {
  supportsResponseStreaming: true,
};

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
  const { teamId, agreementId, responseId } = req.query as {
    teamId: string;
    agreementId: string;
    responseId: string;
  };

  if (!teamId || !agreementId || !responseId) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    const agreementResponse = await prisma.agreementResponse.findFirst({
      where: {
        id: responseId,
        agreementId,
        agreement: {
          teamId,
          team: {
            users: {
              some: {
                userId,
              },
            },
          },
        },
      },
      select: {
        id: true,
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
          },
        },
        view: {
          select: {
            viewerEmail: true,
            viewerName: true,
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

    const fallbackName = buildFallbackFilename({
      agreementName: agreementResponse.agreement.name,
      viewerName: agreementResponse.view?.viewerName,
      viewerEmail: agreementResponse.view?.viewerEmail,
    });

    // Fast path: serve the webhook-mirrored PDF straight from our own storage, with zero Documenso traffic.
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
          filename,
        ),
      });
      return res.redirect(302, url);
    }

    if (!agreementResponse.signingEnvelopeId) {
      throw new TeamError("Signed agreement envelope could not be found.");
    }

    // Fallback for responses not yet mirrored: a single keyed Documenso call.
    const { url: downloadUrl } = await getEnvelopeSignedDownloadUrl({
      envelopeId: agreementResponse.signingEnvelopeId,
      documentId: agreementResponse.signingDocumentId,
    });

    // Best-effort mirror so the next click serves from our storage; the user doesn't wait for it.
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

    // Redirect to the short-lived pre-signed URL instead of streaming bytes back through this function.
    return res.redirect(302, downloadUrl);
  } catch (error) {
    return errorhandler(error, res);
  }
}

const sanitizeSegment = (value: string, max: number) =>
  value
    .replace(/[^a-z0-9\-_]/gi, "_")
    .toLowerCase()
    .substring(0, max);

const buildFallbackFilename = ({
  agreementName,
  viewerName,
  viewerEmail,
}: {
  agreementName: string;
  viewerName?: string | null;
  viewerEmail?: string | null;
}) => {
  const safeName = sanitizeSegment(agreementName, 50) || "agreement";
  const signerSlug = sanitizeSegment(viewerName || viewerEmail || "", 40);

  return signerSlug
    ? `${safeName}_signed_${signerSlug}.pdf`
    : `${safeName}_signed.pdf`;
};
