import { NextApiRequest, NextApiResponse } from "next";

import { parse } from "cookie";

import {
  collectFingerprintHeaders,
  createDataroomSession,
  generateSessionFingerprint,
  getDataroomSessionByLinkIdInPagesRouter,
  updateDataroomSessionVerified,
} from "@/lib/auth/dataroom-auth";
import { sendOtpVerificationEmail } from "@/lib/emails/send-email-otp-verification";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import { generateOTP } from "@/lib/utils/generate-otp";
import { getIpAddress } from "@/lib/utils/ip";

const OTP_IDENTIFIER_PREFIX = "download-otp:";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    const linkId = req.query.linkId as string;
    if (!linkId) {
      return res.status(400).json({ error: "linkId is required" });
    }

    const session = await getDataroomSessionByLinkIdInPagesRouter(req, linkId);
    if (!session) {
      return res
        .status(401)
        .json({ error: "Session required", verified: false });
    }
    return res.status(200).json({ verified: session.verified });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { linkId, viewId: providedViewId, email, code } = req.body as {
    linkId?: string;
    viewId?: string;
    email?: string;
    code?: string;
  };

  if (!linkId || !email) {
    return res
      .status(400)
      .json({ error: "linkId and email are required" });
  }

  // Look up the view: use provided viewId if given, otherwise find by email + linkId
  const view = providedViewId
    ? await prisma.view.findUnique({
        where: { id: providedViewId, linkId, viewType: "DATAROOM_VIEW" },
        select: {
          id: true,
          dataroomId: true,
          viewerId: true,
          viewerEmail: true,
          link: { select: { teamId: true } },
        },
      })
    : await prisma.view.findFirst({
        where: {
          linkId,
          viewType: "DATAROOM_VIEW",
          viewerEmail: { equals: email, mode: "insensitive" },
        },
        select: {
          id: true,
          dataroomId: true,
          viewerId: true,
          viewerEmail: true,
          link: { select: { teamId: true } },
        },
        orderBy: { viewedAt: "desc" },
      });

  if (!view || view.viewerEmail?.toLowerCase() !== email.toLowerCase()) {
    return res
      .status(404)
      .json({ error: "View not found or email does not match" });
  }

  // Use the resolved viewId from here on
  const viewId = view.id;

  if (!view.link?.teamId) {
    return res.status(400).json({ error: "Link has no team" });
  }

  if (!code) {
    const { success: emailLimitSuccess } = await ratelimit(1, "30 s").limit(
      `${OTP_IDENTIFIER_PREFIX}${linkId}:${email.toLowerCase()}`,
    );
    if (!emailLimitSuccess) {
      return res.status(429).json({
        error: "Please wait 30 seconds before requesting another code.",
      });
    }

    const ipAddressValue = getIpAddress(req.headers) ?? "unknown";
    const { success: ipSuccess } = await ratelimit(10, "1 m").limit(
      `download-otp-ip:${ipAddressValue}`,
    );
    if (!ipSuccess) {
      return res.status(429).json({
        error: "Too many requests. Try again later.",
      });
    }

    await prisma.verificationToken.deleteMany({
      where: {
        identifier: `${OTP_IDENTIFIER_PREFIX}${linkId}:${email.toLowerCase()}`,
      },
    });

    const otpCode = generateOTP();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    await prisma.verificationToken.create({
      data: {
        token: otpCode,
        identifier: `${OTP_IDENTIFIER_PREFIX}${linkId}:${email.toLowerCase()}`,
        expires: expiresAt,
      },
    });

    await sendOtpVerificationEmail(email, otpCode, true, view.link.teamId);

    return res.status(200).json({
      type: "email-verification",
      message: "Verification code sent to your email.",
    });
  }

  const { success: ipSuccess } = await ratelimit(10, "1 m").limit(
    `download-verify-ip:${getIpAddress(req.headers) ?? "unknown"}`,
  );
  if (!ipSuccess) {
    return res.status(429).json({ error: "Too many requests." });
  }

  const verification = await prisma.verificationToken.findUnique({
    where: {
      token: code,
      identifier: `${OTP_IDENTIFIER_PREFIX}${linkId}:${email.toLowerCase()}`,
    },
  });

  if (!verification) {
    return res.status(401).json({
      error: "Invalid or expired code. Request a new code.",
      resetVerification: true,
    });
  }

  if (Date.now() > verification.expires.getTime()) {
    await prisma.verificationToken.delete({
      where: { token: code },
    });
    return res.status(401).json({
      error: "Code expired. Request a new code.",
      resetVerification: true,
    });
  }

  await prisma.verificationToken.delete({
    where: { token: code },
  });

  await prisma.view.update({
    where: { id: viewId },
    data: { verified: true },
  });

  const cookies = parse(req.headers.cookie || "");
  let sessionToken = cookies[`pm_drs_${linkId}`];

  const needNewSession = async () => {
    if (!view.dataroomId) return;
    const ipAddressValue = getIpAddress(req.headers) ?? "unknown";
    const pagesHeader = (name: string) => {
      const v = req.headers[name];
      return (Array.isArray(v) ? v[0] : v) ?? null;
    };
    const fingerprint = generateSessionFingerprint(
      collectFingerprintHeaders({ get: pagesHeader }),
    );
    const { token, expiresAt } = await createDataroomSession(
      view.dataroomId,
      linkId,
      viewId,
      ipAddressValue,
      true,
      view.viewerId ?? undefined,
      fingerprint,
    );
    sessionToken = token;
    const maxAge = Math.floor((expiresAt - Date.now()) / 1000);
    res.setHeader("Set-Cookie", [
      `pm_drs_${linkId}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`,
    ]);
  };

  if (sessionToken) {
    const updated = await updateDataroomSessionVerified(sessionToken, true);
    // If update failed (e.g. session expired and was deleted), create a new
    // session so the next request (e.g. bulk) has a valid session.
    if (!updated) {
      await needNewSession();
    }
  } else {
    await needNewSession();
  }

  return res.status(200).json({
    type: "verified",
    message: "Email verified. You can receive download notifications.",
  });
}
