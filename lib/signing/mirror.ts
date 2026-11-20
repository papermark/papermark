import { PutObjectCommand } from "@aws-sdk/client-s3";
import { DocumentStorageType } from "@prisma/client";

import { getTeamS3ClientAndConfig } from "@/lib/files/aws-client";
import { assertS3Transport } from "@/lib/files/transport";
import prisma from "@/lib/prisma";
import { buildContentDisposition, safeSlugify } from "@/lib/utils";

import { getEnvelopeSignedDownloadUrl } from "./envelopes";

// Documenso caps signed PDFs at 50 MB by default; mirror with the same ceiling
// so a malformed upstream response can never blow out our process memory.
const MAX_SIGNED_PDF_BYTES = 50 * 1024 * 1024;

const buildSignedFileKey = ({
  teamId,
  agreementId,
  agreementResponseId,
}: {
  teamId: string;
  agreementId: string;
  agreementResponseId: string;
}) => `${teamId}/agreements/${agreementId}/signed/${agreementResponseId}.pdf`;

const buildSignedFileName = ({
  agreementName,
  signerName,
}: {
  agreementName: string;
  signerName: string | null;
}) => {
  const safeAgreement = safeSlugify(agreementName).slice(0, 60) || "agreement";

  if (!signerName) {
    return `${safeAgreement}_signed.pdf`;
  }

  const safeSigner = safeSlugify(signerName).slice(0, 40);
  return safeSigner
    ? `${safeAgreement}_signed_${safeSigner}.pdf`
    : `${safeAgreement}_signed.pdf`;
};

const fetchSignedPdf = async (url: string): Promise<Buffer> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch signed PDF from Documenso (status ${response.status})`,
    );
  }

  const advertisedLength = response.headers.get("content-length");
  if (advertisedLength) {
    const advertised = Number.parseInt(advertisedLength, 10);
    if (Number.isFinite(advertised) && advertised > MAX_SIGNED_PDF_BYTES) {
      throw new Error(
        `Signed PDF exceeds mirror cap (${advertised} > ${MAX_SIGNED_PDF_BYTES} bytes)`,
      );
    }
  }

  if (!response.body) {
    const fallback = await response.arrayBuffer();
    if (fallback.byteLength > MAX_SIGNED_PDF_BYTES) {
      throw new Error("Signed PDF exceeds mirror cap");
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
    if (total > MAX_SIGNED_PDF_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("Signed PDF exceeds mirror cap");
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
};

const uploadToS3 = async ({
  teamId,
  key,
  contentDisposition,
  body,
}: {
  teamId: string;
  key: string;
  contentDisposition: string;
  body: Buffer;
}) => {
  const { client, config } = await getTeamS3ClientAndConfig(teamId);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: "application/pdf",
      ContentDisposition: contentDisposition,
    }),
  );

  // S3 buckets are private; the object key is the stored reference and
  // downloads are served via short-lived presigned URLs.
  return { storageType: DocumentStorageType.S3_PATH, fileKey: key };
};

/** Mirror a signed Documenso PDF into team S3 storage; idempotent and non-fatal — downloads fall back to a direct Documenso call when the mirror is missing. */
export const mirrorSignedAgreementToStorage = async ({
  agreementResponseId,
}: {
  agreementResponseId: string;
}) => {
  const response = await prisma.agreementResponse.findUnique({
    where: { id: agreementResponseId },
    select: {
      id: true,
      signerName: true,
      signingEnvelopeId: true,
      signingDocumentId: true,
      signedFileKey: true,
      agreement: {
        select: {
          id: true,
          name: true,
          teamId: true,
        },
      },
    },
  });

  if (!response) {
    return { mirrored: false, reason: "response-not-found" as const };
  }

  if (response.signedFileKey) {
    return { mirrored: false, reason: "already-mirrored" as const };
  }

  if (!response.signingEnvelopeId) {
    return { mirrored: false, reason: "missing-envelope" as const };
  }

  const { url } = await getEnvelopeSignedDownloadUrl({
    envelopeId: response.signingEnvelopeId,
    documentId: response.signingDocumentId,
  });

  const body = await fetchSignedPdf(url);

  const teamId = response.agreement.teamId;
  const agreementId = response.agreement.id;
  const signedFileName = buildSignedFileName({
    agreementName: response.agreement.name,
    signerName: response.signerName,
  });
  const signedFileKey = buildSignedFileKey({
    teamId,
    agreementId,
    agreementResponseId: response.id,
  });

  assertS3Transport();

  const { storageType, fileKey } = await uploadToS3({
    teamId,
    key: signedFileKey,
    contentDisposition: buildContentDisposition(signedFileName, signedFileName),
    body,
  });

  await prisma.agreementResponse.update({
    where: { id: response.id },
    data: {
      signedFileKey: fileKey,
      signedFileName,
      signedFileStorageType: storageType,
    },
  });

  return {
    mirrored: true as const,
    signedFileKey: fileKey,
    signedFileName,
    signedFileStorageType: storageType,
  };
};
