import { NextRequest, NextResponse } from "next/server";

import { getServerSession } from "next-auth";

import { verifyRedactionJobAccess } from "@/ee/features/redaction/lib/auth/verify-redaction-access";
import {
  AddManualRedactionSchema,
  UpdateRedactionItemsSchema,
} from "@/ee/features/redaction/lib/schemas/redaction";

import { authOptions } from "@/lib/auth/auth-options";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

/**
 * PATCH /api/redactions/[documentId]/[jobId]/items
 *
 * Bulk update the status (ACCEPTED / DECLINED / PENDING) of individual
 * redaction items in a job. Used by the review panel's per-row toggles and
 * bulk accept/decline buttons.
 */
export async function PATCH(
  req: NextRequest,
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

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateRedactionItemsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Only touch items that actually belong to this job.
  const updates = parsed.data.updates;
  const ids = updates.map((u) => u.id);
  const owned = await prisma.documentRedaction.findMany({
    where: { id: { in: ids }, jobId: params.jobId },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((r) => r.id));

  const validUpdates = updates.filter((u) => ownedIds.has(u.id));

  await prisma.$transaction(
    validUpdates.map((u) =>
      prisma.documentRedaction.update({
        where: { id: u.id },
        data: { status: u.status },
      }),
    ),
  );

  return NextResponse.json({
    updated: validUpdates.length,
    skipped: updates.length - validUpdates.length,
  });
}

/**
 * POST /api/redactions/[documentId]/[jobId]/items
 *
 * Add a user-drawn redaction rectangle to an existing job. Starts as
 * ACCEPTED (no review required for manual draws) and source = "MANUAL".
 * This intentionally shares the same job as AI detections so manual +
 * AI redactions are applied together in a single PDF pass.
 */
export async function POST(
  req: NextRequest,
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

  const body = await req.json().catch(() => ({}));
  const parsed = AddManualRedactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const created = await prisma.documentRedaction.create({
    data: {
      jobId: params.jobId,
      pageNumber: parsed.data.pageNumber,
      x: parsed.data.x,
      y: parsed.data.y,
      width: parsed.data.width,
      height: parsed.data.height,
      detectedText: parsed.data.detectedText ?? null,
      category: parsed.data.category ?? "OTHER",
      reason: parsed.data.reason ?? null,
      source: "MANUAL",
      status: "ACCEPTED",
    },
  });

  return NextResponse.json({ item: created }, { status: 201 });
}
