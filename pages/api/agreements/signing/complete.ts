import { NextApiRequest, NextApiResponse } from "next";

import { z } from "zod";

import { TeamError, errorhandler } from "@/lib/errorHandler";
import {
  buildSignedAgreementAccessCookie,
  mintSignedAgreementAccessToken,
} from "@/lib/signing/access-token";
import { syncAgreementResponseWithSigningDocument } from "@/lib/signing/agreements";

// `syncAgreementResponseWithSigningDocument` schedules a background folder
// move via `waitUntil`, which requires response streaming on Pages API.
export const config = {
  supportsResponseStreaming: true,
};

const completeAgreementSigningSchema = z.object({
  agreementResponseId: z.string().min(1, "Agreement response ID is required."),
  documentId: z.number().int().positive("Signing document ID is required."),
});

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const parseResult = completeAgreementSigningSchema.safeParse(req.body);

    if (!parseResult.success) {
      throw new TeamError("A valid signing completion payload is required.");
    }

    const { agreementResponseId, documentId } = parseResult.data;

    // `syncAgreementResponseWithSigningDocument` enforces the document↔response binding (externalId + template/envelope must match), so a caller can't pair their pending response with another team's signed documentId.
    const updatedAgreementResponse =
      await syncAgreementResponseWithSigningDocument({
        agreementResponseId,
        documentId,
      });

    const cookies: string[] = [];

    if (updatedAgreementResponse.linkId) {
      const accessCookie = mintSignedAgreementAccessToken({
        agreementResponseId: updatedAgreementResponse.id,
        linkId: updatedAgreementResponse.linkId,
        agreementId: updatedAgreementResponse.agreementId,
      });

      cookies.push(
        buildSignedAgreementAccessCookie({
          linkId: updatedAgreementResponse.linkId,
          token: accessCookie.token,
          maxAgeSeconds: accessCookie.maxAgeSeconds,
          secure: process.env.NODE_ENV === "production",
        }),
      );
    }

    if (cookies.length > 0) {
      res.setHeader("Set-Cookie", cookies);
    }

    return res.status(200).json({
      id: updatedAgreementResponse.id,
      signingStatus: updatedAgreementResponse.signingStatus,
    });
  } catch (error) {
    return errorhandler(error, res);
  }
}
