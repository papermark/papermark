import { NextApiRequest } from "next";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { ipAddress } from "@vercel/functions";
import { parse } from "cookie";
import crypto from "crypto";
import { z } from "zod";

import { redis } from "@/lib/redis";

import { LOCALHOST_IP } from "../utils/geo";
import { getIpAddress } from "../utils/ip";

const COOKIE_EXPIRATION_TIME = 23 * 60 * 60 * 1000; // 23 hours

/**
 * Normalize IP addresses so that IPv6 loopback (::1),
 * IPv4-mapped IPv6 (::ffff:127.0.0.1) and plain 127.0.0.1
 * all compare equal.
 */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  if (trimmed === "::1" || trimmed === "::ffff:127.0.0.1") {
    return LOCALHOST_IP;
  }
  if (trimmed.startsWith("::ffff:")) {
    return trimmed.slice(7);
  }
  return trimmed;
}

/**
 * Generate a stable browser fingerprint from request headers.
 * Combines User-Agent, Accept-Language, and Sec-CH-UA client hints
 * which remain constant across IP changes but differ between
 * browsers/devices, making session sharing significantly harder.
 *
 * Sec-CH-UA headers are automatically sent by Chromium browsers and
 * cannot be overridden by simple cookie-copy tools or browser extensions.
 */
export function generateSessionFingerprint(headers: {
  userAgent: string;
  acceptLanguage?: string;
  secChUa?: string;
  secChUaPlatform?: string;
  secChUaMobile?: string;
}): string {
  const parts = [
    headers.userAgent,
    headers.acceptLanguage ?? "",
    headers.secChUa ?? "",
    headers.secChUaPlatform ?? "",
    headers.secChUaMobile ?? "",
  ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

export function collectFingerprintHeaders(h: {
  get(name: string): string | null;
}): Parameters<typeof generateSessionFingerprint>[0] {
  return {
    userAgent: h.get("user-agent") ?? "unknown",
    acceptLanguage: h.get("accept-language") ?? undefined,
    secChUa: h.get("sec-ch-ua") ?? undefined,
    secChUaPlatform: h.get("sec-ch-ua-platform") ?? undefined,
    secChUaMobile: h.get("sec-ch-ua-mobile") ?? undefined,
  };
}

function getFingerprintFromNextRequest(request: NextRequest): string {
  return generateSessionFingerprint(collectFingerprintHeaders(request.headers));
}

function getFingerprintFromPagesRequest(req: NextApiRequest): string {
  const header = (name: string) => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v) ?? null;
  };
  return generateSessionFingerprint(
    collectFingerprintHeaders({ get: header }),
  );
}

// Define the Zod schema for session data
export const DataroomSessionSchema = z.object({
  linkId: z.string(),
  dataroomId: z.string(),
  viewId: z.string(),
  viewerId: z.string().optional(),
  expiresAt: z.number(),
  ipAddress: z.string(),
  fingerprint: z.string().optional(),
  verified: z.boolean(),
});

// Generate TypeScript type from Zod schema
export type DataroomSession = z.infer<typeof DataroomSessionSchema>;

async function createDataroomSession(
  dataroomId: string,
  linkId: string,
  viewId: string,
  ipAddress: string,
  verified: boolean,
  viewerId?: string,
  fingerprint?: string,
): Promise<{ token: string; expiresAt: number }> {
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + COOKIE_EXPIRATION_TIME;

  const sessionData: DataroomSession = {
    dataroomId,
    linkId,
    viewId,
    viewerId,
    expiresAt,
    ipAddress: normalizeIp(ipAddress),
    fingerprint,
    verified,
  };

  DataroomSessionSchema.parse(sessionData);

  await redis.set(
    `dataroom_session:${sessionToken}`,
    JSON.stringify(sessionData),
    { pxat: expiresAt },
  );

  return {
    token: sessionToken,
    expiresAt,
  };
}

async function verifyDataroomSession(
  request: NextRequest,
  linkId: string,
  dataroomId: string,
): Promise<DataroomSession | null> {
  if (!dataroomId) return null;

  const sessionToken = cookies().get(`pm_drs_${linkId}`)?.value;
  if (!sessionToken) return null;

  const session = await redis.get(`dataroom_session:${sessionToken}`);
  if (!session) return null;

  try {
    const sessionData = DataroomSessionSchema.parse(session);

    if (sessionData.expiresAt < Date.now()) {
      await redis.del(`dataroom_session:${sessionToken}`);
      return null;
    }

    // Validate browser fingerprint instead of IP to handle VPN/network changes.
    // Sessions created before this change won't have a fingerprint; for those
    // we fall back to the legacy IP check for a smooth rollout.
    if (sessionData.fingerprint) {
      const currentFingerprint = getFingerprintFromNextRequest(request);
      if (currentFingerprint !== sessionData.fingerprint) {
        await redis.del(`dataroom_session:${sessionToken}`);
        return null;
      }
    } else {
      const ipAddressValue = normalizeIp(ipAddress(request) ?? LOCALHOST_IP);
      if (ipAddressValue !== sessionData.ipAddress) {
        await redis.del(`dataroom_session:${sessionToken}`);
        return null;
      }
    }

    if (
      sessionData.linkId !== linkId ||
      sessionData.dataroomId !== dataroomId
    ) {
      await redis.del(`dataroom_session:${sessionToken}`);
      return null;
    }

    return sessionData;
  } catch (error) {
    await redis.del(`dataroom_session:${sessionToken}`);
    return null;
  }
}

export async function verifyDataroomSessionInPagesRouter(
  req: NextApiRequest,
  linkId: string,
  dataroomId: string,
): Promise<DataroomSession | null> {
  if (!dataroomId) return null;

  const sessionData = await getDataroomSessionByLinkIdInPagesRouter(
    req,
    linkId,
  );
  if (!sessionData || sessionData.dataroomId !== dataroomId) return null;
  return sessionData;
}

/**
 * Get dataroom session by linkId only (e.g. for downloads page where dataroomId may not be in context).
 */
export async function getDataroomSessionByLinkIdInPagesRouter(
  req: NextApiRequest,
  linkId: string,
): Promise<DataroomSession | null> {
  if (!linkId) return null;

  const cookies = parse(req.headers.cookie || "");
  const sessionToken = cookies[`pm_drs_${linkId}`];
  if (!sessionToken) {
    return null;
  }

  const session = await redis.get(`dataroom_session:${sessionToken}`);
  if (!session) return null;

  try {
    const sessionData = DataroomSessionSchema.parse(session);

    if (sessionData.expiresAt < Date.now()) {
      await redis.del(`dataroom_session:${sessionToken}`);
      return null;
    }

    if (sessionData.fingerprint) {
      const currentFingerprint = getFingerprintFromPagesRequest(req);
      if (currentFingerprint !== sessionData.fingerprint) {
        await redis.del(`dataroom_session:${sessionToken}`);
        return null;
      }
    } else {
      const ipAddressValue = normalizeIp(
        getIpAddress(req.headers) ?? LOCALHOST_IP,
      );
      if (ipAddressValue !== sessionData.ipAddress) {
        await redis.del(`dataroom_session:${sessionToken}`);
        return null;
      }
    }

    if (sessionData.linkId !== linkId) {
      await redis.del(`dataroom_session:${sessionToken}`);
      return null;
    }

    return sessionData;
  } catch (error) {
    await redis.del(`dataroom_session:${sessionToken}`);
    return null;
  }
}

/**
 * Update the verified flag of an existing dataroom session (e.g. after OTP verification).
 * Caller must obtain sessionToken from the request cookie (pm_drs_{linkId}).
 */
export async function updateDataroomSessionVerified(
  sessionToken: string,
  verified: boolean,
): Promise<boolean> {
  if (!sessionToken) return false;

  const raw = await redis.get(`dataroom_session:${sessionToken}`);
  if (!raw) return false;

  try {
    const sessionData = DataroomSessionSchema.parse(
      typeof raw === "string" ? JSON.parse(raw) : raw,
    );
    if (sessionData.expiresAt < Date.now()) {
      await redis.del(`dataroom_session:${sessionToken}`);
      return false;
    }

    const updated: DataroomSession = { ...sessionData, verified };
    await redis.set(
      `dataroom_session:${sessionToken}`,
      JSON.stringify(updated),
      {
        pxat: sessionData.expiresAt,
      },
    );
    return true;
  } catch {
    return false;
  }
}

export { createDataroomSession, verifyDataroomSession };
