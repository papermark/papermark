import { NextRequest, NextResponse } from "next/server";

import { getServerSession } from "next-auth";

import { verifyRedactionJobAccess } from "@/ee/features/redaction/lib/auth/verify-redaction-access";
import type { applyRedactionsTask } from "@/ee/features/redaction/lib/trigger/apply-redactions";
import { tasks } from "@trigger.dev/sdk";

import { authOptions } from "@/lib/auth/auth-options";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

/**
 * POST /api/redactions/[documentId]/[jobId]/apply
 *
 * Apply all ACCEPTED redactions to the document. Triggers the
 * `apply-redactions` task which (1) burns black rectangles onto the PDF
 * using @libpdf/core, (2) creates a new DocumentVersion, (3) re-rasterizes
 * pages via the existing `convert-pdf-to-image-route` pipeline, and (4)
 * marks the job as APPLIED.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { documentId: string; jobId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as CustomUser).id;

  const access = await verifyRedactionJobAccess({
    userId,
    jobId: params.jobId,
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }
  if (access.documentId !== params.documentId) {
    return NextResponse.json(
      { error: "Job does not belong to this document" },
      { status: 400 },
    );
  }

  const job = await prisma.documentRedactionJob.findUnique({
    where: { id: params.jobId },
    select: {
      id: true,
      status: true,
      teamId: true,
      _count: { select: { redactions: { where: { status: "ACCEPTED" } } } },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status === "APPLIED") {
    return NextResponse.json(
      { error: "Redactions have already been applied" },
      { status: 409 },
    );
  }

  if (job.status === "APPLYING") {
    return NextResponse.json(
      { error: "Redactions are already being applied" },
      { status: 409 },
    );
  }

  if (job._count.redactions === 0) {
    return NextResponse.json(
      { error: "No accepted redactions to apply. Accept at least one first." },
      { status: 400 },
    );
  }

  try {
    const handle = await tasks.trigger<typeof applyRedactionsTask>(
      "apply-redactions",
      { jobId: job.id },
      {
        tags: [
          `team_${job.teamId}`,
          `document_${params.documentId}`,
          `redaction_job:${job.id}`,
        ],
        concurrencyKey: job.teamId,
      },
    );

    await prisma.documentRedactionJob.update({
      where: { id: job.id },
      data: { triggerRunId: handle.id, status: "APPLYING" },
    });

    return NextResponse.json({
      runId: handle.id,
      publicAccessToken: handle.publicAccessToken,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to start redaction apply task", details: errorMessage },
      { status: 500 },
    );
  }
}
