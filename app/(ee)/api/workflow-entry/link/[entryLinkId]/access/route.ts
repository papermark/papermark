import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { WorkflowEngine } from "@/ee/features/workflows/lib/engine";
import { AccessRequestSchema } from "@/ee/features/workflows/lib/types";
import { ipAddress } from "@vercel/functions";
import { z } from "zod";

import {
  collectFingerprintHeaders,
  createDataroomSession,
  generateSessionFingerprint,
} from "@/lib/auth/dataroom-auth";
import { createLinkSession } from "@/lib/auth/link-session";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import { LOCALHOST_IP } from "@/lib/utils/geo";

// POST /app/(ee)/api/workflow-entry/[entryLinkId]/access - Verify OTP and execute workflow
export async function POST(
  req: NextRequest,
  { params }: { params: { entryLinkId: string } },
) {
  try {
    const { entryLinkId } = params;
    const body = await req.json();

    // Validate entryLinkId format
    const linkIdValidation = z.string().cuid().safeParse(entryLinkId);
    if (!linkIdValidation.success) {
      return NextResponse.json(
        { error: "Invalid link ID format" },
        { status: 400 },
      );
    }

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

    // Find workflow by entry link
    const workflow = await prisma.workflow.findUnique({
      where: { entryLinkId },
      select: {
        id: true,
        isActive: true,
        teamId: true,
        entryLink: {
          select: {
            id: true,
            isArchived: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow entry link not found" },
        { status: 404 },
      );
    }

    if (!workflow.isActive) {
      return NextResponse.json(
        { error: "This workflow is currently inactive" },
        { status: 403 },
      );
    }

    if (workflow.entryLink.isArchived || workflow.entryLink.deletedAt) {
      return NextResponse.json(
        { error: "This link is no longer available" },
        { status: 404 },
      );
    }

    // Verify OTP code
    const verification = await prisma.verificationToken.findUnique({
      where: {
        token: code,
        identifier: `workflow-otp:${entryLinkId}:${email}`,
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

    const executionResult = await engine.execute(entryLinkId, {
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
          teamId: workflow.teamId,
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
          teamId: workflow.teamId,
        },
        select: { id: true },
      });
    }

    // Create a view record for the workflow execution
    const view = await prisma.view.create({
      data: {
        linkId: entryLinkId,
        viewerEmail: email,
        viewerId: viewer.id,
        verified: true,
        teamId: workflow.teamId,
        viewType:
          executionResult.targetLinkType === "DATAROOM_LINK"
            ? "DATAROOM_VIEW"
            : "DOCUMENT_VIEW",
        documentId: executionResult.targetDocumentId ?? undefined,
        dataroomId: executionResult.targetDataroomId ?? undefined,
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
    let targetPath = `/view/${executionResult.targetLinkId}`;
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
  } catch (error) {
    console.error("Error verifying workflow access:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
