import { NextRequest, NextResponse } from "next/server";

import { getServerSession } from "next-auth";

import { verifyRedactionJobAccess } from "@/ee/features/redaction/lib/auth/verify-redaction-access";

import { authOptions } from "@/lib/auth/auth-options";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

/**
 * GET /api/redactions/[documentId]/[jobId]
 *
 * Fetch a single redaction job along with all of its redaction items.
 * Items are grouped client-side; we keep the server shape flat so the
 * client can decide how to render them.
 */
export async function GET(
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
    include: {
      redactions: {
        orderBy: [{ pageNumber: "asc" }, { createdAt: "asc" }],
      },
      createdBy: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}

/**
 * DELETE /api/redactions/[documentId]/[jobId]
 *
 * Discard a redaction job and all of its suggested redactions. Safe to call
 * at any time before the job is APPLIED; once applied we keep the history
 * so users can audit what was redacted.
 */
export async function DELETE(
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
    select: { status: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status === "APPLIED") {
    return NextResponse.json(
      {
        error:
          "Cannot delete an applied redaction job. Unredact the document instead.",
      },
      { status: 409 },
    );
  }

  await prisma.documentRedactionJob.delete({
    where: { id: params.jobId },
  });

  return NextResponse.json({ ok: true });
}
