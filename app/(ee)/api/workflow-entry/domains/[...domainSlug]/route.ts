import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { WorkflowEngine } from "@/ee/features/workflows/lib/engine";
import {
  AccessRequestSchema,
  VerifyEmailRequestSchema,
} from "@/ee/features/workflows/lib/types";
import { ipAddress, waitUntil } from "@vercel/functions";
import { z } from "zod";

import {
  collectFingerprintHeaders,
  createDataroomSession,
  generateSessionFingerprint,
} from "@/lib/auth/dataroom-auth";
import { createLinkSession } from "@/lib/auth/link-session";
import { sendOtpVerificationEmail } from "@/lib/emails/send-email-otp-verification";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import { generateOTP } from "@/lib/utils/generate-otp";
import { LOCALHOST_IP } from "@/lib/utils/geo";

// POST /app/(ee)/api/workflow-entry/domains/[domain]/[slug]/[action]
// where action is "verify" or "access"
export async function POST(
  req: NextRequest,
  { params }: { params: { domainSlug: string[] } },
) {
  try {
    const domainSlug = params.domainSlug;

    if (!domainSlug || domainSlug.length < 3) {
      return NextResponse.json(
        { error: "Invalid URL format. Expected: domain/slug/action" },
        { status: 400 },
      );
    }

    const domain = domainSlug[0];
    const slug = domainSlug[1];
    const action = domainSlug[2]; // "verify" or "access"

    if (action !== "verify" && action !== "access") {
      return NextResponse.json(
        { error: "Invalid action. Must be 'verify' or 'access'" },
        { status: 400 },
      );
    }

    // Find workflow by entry link's domain and slug
    const link = await prisma.link.findUnique({
      where: {
        domainSlug_slug: {
          domainSlug: domain,
          slug: slug,
        },
        linkType: "WORKFLOW_LINK",
      },
      select: {
        id: true,
        isArchived: true,
        deletedAt: true,
        workflow: {
          select: {
            id: true,
            isActive: true,
            name: true,
            teamId: true,
            entryLinkId: true,
          },
        },
      },
    });

    if (!link || !link.workflow) {
      return NextResponse.json(
        { error: "Workflow entry link not found" },
        { status: 404 },
      );
    }

    if (!link.workflow.isActive) {
      return NextResponse.json(
        { error: "This workflow is currently inactive" },
        { status: 403 },
      );
    }

    if (link.isArchived || link.deletedAt) {
      return NextResponse.json(
        { error: "This link is no longer available" },
        { status: 404 },
      );
    }

    // Handle verify action
    if (action === "verify") {
      return handleVerify(req, link);
    }

    // Handle access action
    if (action === "access") {
      return handleAccess(req, link);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Error in workflow entry endpoint:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Handle verify (send OTP)
async function handleVerify(req: NextRequest, link: any) {
  const body = await req.json();

  // Validate request body
  const validation = VerifyEmailRequestSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid email address" },
      { status: 400 },
    );
  }

  const { email } = validation.data;

  // Rate limit per email/link combination (1 per 30 seconds) to prevent OTP flooding
  const { success: emailLimitSuccess } = await ratelimit(1, "30 s").limit(
    `workflow-otp:${link.id}:${email}`,
  );
  if (!emailLimitSuccess) {
    return NextResponse.json(
      {
        error:
          "Please wait before requesting another code. Try again in 30 seconds.",
      },
      { status: 429 },
    );
  }

  // Additional IP-based rate limit (10 per minute) to prevent abuse across different emails
  const ipAddressValue = ipAddress(req);
  const { success } = await ratelimit(10, "1 m").limit(
    `workflow-otp:${ipAddressValue}`,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

  // Delete any existing OTP codes for this workflow entry + email
  await prisma.verificationToken.deleteMany({
    where: {
      identifier: `workflow-otp:${link.id}:${email}`,
    },
  });

  // Generate and store OTP
  const otpCode = generateOTP();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10); // expires in 10 minutes

  await prisma.verificationToken.create({
    data: {
      token: otpCode,
      identifier: `workflow-otp:${link.id}:${email}`,
      expires: expiresAt,
    },
  });

  // Send OTP email
  waitUntil(
    sendOtpVerificationEmail(email, otpCode, false, link.workflow.teamId),
  );

  return NextResponse.json({
    success: true,
    message: "Verification code sent to your email",
  });
}

// Handle access (verify OTP and execute workflow)
async function handleAccess(req: NextRequest, link: any) {
  const body = await req.json();

  // Validate request body
  const validation = AccessRequestSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request data" },
      { status: 400 },
    );
  }

  const { email, code } = validation.data;

  // Rate limiting
  const ipAddressValue = ipAddress(req) ?? LOCALHOST_IP;
  const { success } = await ratelimit(10, "1 m").limit(
    `workflow-verify:${ipAddressValue}`,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

  // Verify OTP code
  const verification = await prisma.verificationToken.findUnique({
    where: {
      token: code,
      identifier: `workflow-otp:${link.id}:${email}`,
    },
  });

  if (!verification) {
    return NextResponse.json(
      { error: "Invalid verification code", resetVerification: true },
      { status: 401 },
    );
  }

  // Check OTP expiration
  if (Date.now() > verification.expires.getTime()) {
    await prisma.verificationToken.delete({
      where: { token: code },
    });
    return NextResponse.json(
      { error: "Verification code expired", resetVerification: true },
      { status: 401 },
    );
  }

  // Delete OTP after successful verification
  await prisma.verificationToken.delete({
    where: { token: code },
  });

  // Execute workflow engine
  const engine = new WorkflowEngine();
  const userAgent = req.headers.get("user-agent") ?? "unknown";
  const referrer = req.headers.get("referer") ?? undefined;

  const executionResult = await engine.execute(link.workflow.entryLinkId, {
    visitorEmail: email,
    visitorIp: ipAddressValue,
    userAgent,
    referrer,
  });

  if (!executionResult.success) {
    return NextResponse.json(
      { error: executionResult.error || "Workflow execution failed" },
      { status: 400 },
    );
  }

  // Find or create viewer
  let viewer = await prisma.viewer.findUnique({
    where: {
      teamId_email: {
        teamId: link.workflow.teamId,
        email: email,
      },
    },
    select: { id: true },
  });

  if (!viewer) {
    viewer = await prisma.viewer.create({
      data: {
        email: email,
        verified: true,
        teamId: link.workflow.teamId,
      },
      select: { id: true },
    });
  }

  // Create a view record for the workflow execution
  const view = await prisma.view.create({
    data: {
      linkId: link.id,
      viewerEmail: email,
      viewerId: viewer.id,
      verified: true,
      teamId: link.workflow.teamId,
      documentId: executionResult.targetDocumentId ?? undefined,
      dataroomId: executionResult.targetDataroomId ?? undefined,
      viewType:
        executionResult.targetLinkType === "DATAROOM_LINK"
          ? "DATAROOM_VIEW"
          : "DOCUMENT_VIEW",
    },
    select: { id: true },
  });

  // Create link session for the target link
  const linkFingerprint = generateSessionFingerprint(
    collectFingerprintHeaders(req.headers),
  );
  const { token: sessionToken, expiresAt } = await createLinkSession(
    executionResult.targetLinkId!,
    executionResult.targetLinkType!,
    view.id,
    email,
    ipAddressValue,
    userAgent,
    true, // verified
    viewer.id, // viewerId
    executionResult.targetDocumentId,
    executionResult.targetDataroomId,
    linkFingerprint,
  );

  // Parse target URL safely with fallback
  let targetPath = "/";
  let cookieFlagId = executionResult.targetLinkId;

  if (executionResult.targetUrl) {
    try {
      const parsedUrl = new URL(executionResult.targetUrl);
      targetPath = parsedUrl.pathname;
      const pathSegment = parsedUrl.pathname.split("/").pop();
      if (pathSegment) {
        cookieFlagId = pathSegment;
      }
    } catch (error) {
      console.error("Failed to parse target URL, using fallback values");
    }
  }

  // Set link session cookie (httpOnly)
  cookies().set(`pm_ls_${executionResult.targetLinkId}`, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(expiresAt),
    path: "/",
  });

  // Set client-readable flag cookie for auto-login detection
  const flagCookieId = `pm_link_flag_${cookieFlagId}`;
  cookies().set(flagCookieId, "true", {
    httpOnly: false, // Client-readable
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(expiresAt),
    path: targetPath,
  });

  // If routing to a dataroom, also create and set dataroom session cookie
  if (
    executionResult.targetLinkType === "DATAROOM_LINK" &&
    executionResult.targetDataroomId &&
    viewer
  ) {
    const fingerprint = generateSessionFingerprint(
      collectFingerprintHeaders(req.headers),
    );
    const dataroomSession = await createDataroomSession(
      executionResult.targetDataroomId,
      executionResult.targetLinkId!,
      view.id,
      ipAddressValue,
      true, // verified
      viewer.id,
      fingerprint,
    );

    cookies().set(
      `pm_drs_${executionResult.targetLinkId}`,
      dataroomSession.token,
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        expires: new Date(dataroomSession.expiresAt),
        path: "/",
      },
    );

    // Set client-readable flag cookie for dataroom
    const dataroomFlagId = `pm_drs_flag_${cookieFlagId}`;
    cookies().set(dataroomFlagId, "true", {
      httpOnly: false, // Client-readable
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: new Date(dataroomSession.expiresAt),
      path: targetPath,
    });
  }

  return NextResponse.json({
    success: true,
    targetUrl: executionResult.targetUrl,
    targetLinkId: executionResult.targetLinkId,
    targetLinkType: executionResult.targetLinkType,
  });
}
