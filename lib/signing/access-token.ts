import crypto from "crypto";

import { TeamError } from "@/lib/errorHandler";

// Long-lived HMAC cookie binding the browser to (linkId, agreementId, agreementResponseId) so signed state survives refresh without email lookups (which would enable enumeration).

const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export const SIGNED_ACCESS_COOKIE_PREFIX = "pm_sas_";
// Path-scope to "/" so the cookie reaches the views/status/download routes; the HMAC binding plus HttpOnly + SameSite=Lax + Secure carry the security.
export const SIGNED_ACCESS_COOKIE_PATH = "/";

interface AccessTokenPayload {
  agreementResponseId: string;
  linkId: string;
  agreementId: string;
  exp: number;
}

const getTokenSecret = (): string => {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new TeamError(
      "Signing access token cannot be issued: NEXTAUTH_SECRET is not set.",
    );
  }
  return secret;
};

const sign = (payloadB64: string, secret: string): string =>
  crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");

export const getSignedAgreementAccessCookieName = (linkId: string): string =>
  `${SIGNED_ACCESS_COOKIE_PREFIX}${linkId}`;

export const mintSignedAgreementAccessToken = ({
  agreementResponseId,
  linkId,
  agreementId,
}: {
  agreementResponseId: string;
  linkId: string;
  agreementId: string;
}): { token: string; expiresAt: number; maxAgeSeconds: number } => {
  const secret = getTokenSecret();
  const expiresAt = Date.now() + TOKEN_TTL_MS;

  const payload: AccessTokenPayload = {
    agreementResponseId,
    linkId,
    agreementId,
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

export const parseSignedAgreementAccessToken = (
  token: string | undefined | null,
): AccessTokenPayload | null => {
  if (!token || typeof token !== "string") {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) {
    return null;
  }

  let secret: string;
  try {
    secret = getTokenSecret();
  } catch {
    return null;
  }

  const expectedSignature = sign(payloadB64, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  let payload: AccessTokenPayload;
  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as AccessTokenPayload | null;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    payload = parsed;
  } catch {
    return null;
  }

  if (
    typeof payload.agreementResponseId !== "string" ||
    typeof payload.linkId !== "string" ||
    typeof payload.agreementId !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  if (payload.exp < Date.now()) {
    return null;
  }

  return payload;
};

export const verifySignedAgreementAccessToken = (
  token: string | undefined | null,
  expected: {
    linkId: string;
    agreementId: string;
    agreementResponseId?: string;
  },
): boolean => {
  const payload = parseSignedAgreementAccessToken(token);
  if (!payload) {
    return false;
  }

  if (payload.linkId !== expected.linkId) {
    return false;
  }

  if (payload.agreementId !== expected.agreementId) {
    return false;
  }

  if (
    expected.agreementResponseId &&
    payload.agreementResponseId !== expected.agreementResponseId
  ) {
    return false;
  }

  return true;
};

export const buildSignedAgreementAccessCookie = ({
  linkId,
  token,
  maxAgeSeconds,
  secure,
}: {
  linkId: string;
  token: string;
  maxAgeSeconds: number;
  secure: boolean;
}): string => {
  const parts = [
    `${getSignedAgreementAccessCookieName(linkId)}=${token}`,
    `Path=${SIGNED_ACCESS_COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
};
