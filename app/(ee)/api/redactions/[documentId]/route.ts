import { NextRequest, NextResponse } from "next/server";

import { getServerSession } from "next-auth";

import { verifyRedactionAccess } from "@/ee/features/redaction/lib/auth/verify-redaction-access";
import {
  CreateRedactionJobSchema,
  type RedactionJobStatus,
} from "@/ee/features/redaction/lib/schemas/redaction";
import type { detectRedactionsTask } from "@/ee/features/redaction/lib/trigger/detect-redactions";
import { tasks } from "@trigger.dev/sdk";

import { authOptions } from "@/lib/auth/auth-options";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

/**
 * GET /api/redactions/[documentId]
 *
 * List redaction jobs for a document, most recent first. Includes aggregate
 * counts per status so the dashboard can render summaries without pulling
 * every single redaction.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { documentId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as CustomUser).id;

  const access = await verifyRedactionAccess({
    userId,
    documentId: params.documentId,
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  const jobs = await prisma.documentRedactionJob.findMany({
    where: { documentId: params.documentId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      customTerms: true,
      triggerRunId: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
      documentVersionId: true,
      // The version produced by this job (null until APPLIED). Clients can
      // match this against the current primary version to know whether the
      // document is currently showing the redacted output of this job.
      resultingVersionId: true,
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      _count: {
        select: { redactions: true },
      },
    },
  });

  return NextResponse.json({ jobs });
}

/**
 * POST /api/redactions/[documentId]
 *
 * Start a new redaction job for this document. Creates the job row and
 * triggers the AI detection task. The client polls the job (or subscribes
 * via Trigger.dev Realtime) to display progress and review results.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { documentId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as CustomUser).id;

  const body = await req.json().catch(() => ({}));
  const parsed = CreateRedactionJobSchema.safeParse({
    documentId: params.documentId,
    ...body,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const access = await verifyRedactionAccess({
    userId,
    documentId: parsed.data.documentId,
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  // Use the primary (latest) version as the redaction source.
  const primaryVersion = await prisma.documentVersion.findFirst({
    where: {
      documentId: parsed.data.documentId,
      isPrimary: true,
    },
    select: { id: true, hasPages: true, type: true },
  });

  if (!primaryVersion) {
    return NextResponse.json(
      { error: "Document has no primary version" },
      { status: 400 },
    );
  }

  if (!primaryVersion.hasPages) {
    return NextResponse.json(
      {
        error:
          "Document has not finished processing yet. Please wait for page conversion to complete.",
      },
      { status: 409 },
    );
  }

  const status: RedactionJobStatus = "PENDING";
  const job = await prisma.documentRedactionJob.create({
    data: {
      documentId: parsed.data.documentId,
      documentVersionId: primaryVersion.id,
      teamId: access.teamId,
      createdById: userId,
      status,
      customTerms: parsed.data.customTerms,
    },
  });

  // Kick off the detection task. If triggering fails we mark the job as
  // FAILED and surface the error, rather than leaving it in PENDING forever.
  try {
    const handle = await tasks.trigger<typeof detectRedactionsTask>(
      "detect-redactions",
      {
        jobId: job.id,
        documentId: job.documentId,
        documentVersionId: job.documentVersionId,
        teamId: job.teamId,
        customTerms: job.customTerms,
      },
      {
        tags: [
          `team_${job.teamId}`,
          `document_${job.documentId}`,
          `redaction_job:${job.id}`,
        ],
        concurrencyKey: job.teamId,
      },
    );

    await prisma.documentRedactionJob.update({
      where: { id: job.id },
      data: { triggerRunId: handle.id },
    });

    return NextResponse.json(
      {
        job: { ...job, triggerRunId: handle.id },
        publicAccessToken: handle.publicAccessToken,
      },
      { status: 201 },
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    await prisma.documentRedactionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMessage },
    });
    return NextResponse.json(
      { error: "Failed to start redaction detection", details: errorMessage },
      { status: 500 },
    );
  }
}
