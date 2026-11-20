import crypto from "crypto";

import { TeamError } from "@/lib/errorHandler";

// Short-lived HMAC token scoped to a single (agreementResponseId, linkId) pair so a visitor can fetch only that signed PDF before the access form is submitted.

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const SIGNED_DOWNLOAD_COOKIE_NAME = "pm_sds";
export const SIGNED_DOWNLOAD_COOKIE_PATH = "/api/agreements/signing";

interface DownloadTokenPayload {
  agreementResponseId: string;
  linkId: string;
  exp: number;
}

const getTokenSecret = (): string => {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    // We deliberately throw here so a misconfigured deploy fails loudly
    // instead of silently issuing unauthenticated downloads.
    throw new TeamError(
      "Signing download token cannot be issued: NEXTAUTH_SECRET is not set.",
    );
  }
  return secret;
};

const sign = (payloadB64: string, secret: string): string =>
  crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");

export const mintSignedAgreementDownloadToken = ({
  agreementResponseId,
  linkId,
}: {
  agreementResponseId: string;
  linkId: string;
}): { token: string; expiresAt: number; maxAgeSeconds: number } => {
  const secret = getTokenSecret();
  const expiresAt = Date.now() + TOKEN_TTL_MS;

  const payload: DownloadTokenPayload = {
    agreementResponseId,
    linkId,
    exp: expiresAt,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(payloadB64, secret);

  return {
    token: `${payloadB64}.${signature}`,
    expiresAt,
    maxAgeSeconds: Math.floor(TOKEN_TTL_MS / 1000),
  };
};

export const verifySignedAgreementDownloadToken = (
  token: string | undefined | null,
  expected: { agreementResponseId: string; linkId: string },
): boolean => {
  if (!token || typeof token !== "string") {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return false;
  }

  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) {
    return false;
  }

  let secret: string;
  try {
    secret = getTokenSecret();
  } catch {
    return false;
  }

  const expectedSignature = sign(payloadB64, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return false;
  }

  let payload: DownloadTokenPayload;
  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as DownloadTokenPayload | null;
    if (!parsed || typeof parsed !== "object") {
      return false;
    }
    payload = parsed;
  } catch {
    return false;
  }

  if (
    typeof payload.agreementResponseId !== "string" ||
    typeof payload.linkId !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return false;
  }

  if (payload.exp < Date.now()) {
    return false;
  }

  if (
    payload.agreementResponseId !== expected.agreementResponseId ||
    payload.linkId !== expected.linkId
  ) {
    return false;
  }

  return true;
};

// Cookie serializer; path-scoped to `/api/agreements/signing` so it only attaches to signing requests.
export const buildSignedAgreementDownloadCookie = ({
  token,
  maxAgeSeconds,
  secure,
}: {
  token: string;
  maxAgeSeconds: number;
  secure: boolean;
}): string => {
  const parts = [
    `${SIGNED_DOWNLOAD_COOKIE_NAME}=${token}`,
    `Path=${SIGNED_DOWNLOAD_COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
};
