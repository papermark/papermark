import { NextRequest, NextResponse } from "next/server";

import { waitUntil } from "@vercel/functions";
import { z } from "zod";

import {
  SIGNING_STATUS_SCHEMA,
  findAgreementResponseByExternalId,
  getAgreementResponseSignedState,
  syncAgreementResponseWithSigningDocument,
  verifySigningWebhookSecret,
} from "@/lib/signing/agreements";
import { mirrorSignedAgreementToStorage } from "@/lib/signing/mirror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const signingWebhookSchema = z.object({
  event: z.string(),
  payload: z.object({
    id: z.number().int().positive(),
    externalId: z.string().nullable().optional(),
  }),
});

const SIGNING_EVENTS = new Set(["DOCUMENT_SIGNED", "DOCUMENT_COMPLETED"]);

// POST /api/webhooks/signing – receive Documenso signing webhooks
export async function POST(req: NextRequest) {
  const secretHeader = req.headers.get("x-documenso-secret");
  const { ok, configured } = verifySigningWebhookSecret(secretHeader);

  // Distinguish a missing-secret misconfiguration (503 so Documenso keeps retrying) from a forged call (401 immediately).
  if (!configured) {
    return NextResponse.json(
      { message: "Signing webhook is not configured." },
      { status: 503 },
    );
  }

  if (!ok) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    const parseResult = signingWebhookSchema.safeParse(body);

    if (!parseResult.success) {
      // 400 (not 200) so Documenso surfaces schema drift and we can detect upstream payload changes.
      return NextResponse.json(
        { message: "Invalid webhook payload." },
        { status: 400 },
      );
    }

    const {
      event,
      payload: { externalId, id: documentId },
    } = parseResult.data;

    if (!SIGNING_EVENTS.has(event) || !externalId) {
      return NextResponse.json({ ok: true });
    }

    const agreementResponse =
      await findAgreementResponseByExternalId(externalId);

    if (!agreementResponse) {
      return NextResponse.json({ ok: true });
    }

    // Idempotency: skip the write if already in a terminal signed state, but only short-circuit for SIGNED events since DOCUMENT_COMPLETED may still upgrade a prior DOCUMENT_SIGNED row.
    const nextStatus =
      event === "DOCUMENT_COMPLETED"
        ? SIGNING_STATUS_SCHEMA.enum.COMPLETED
        : SIGNING_STATUS_SCHEMA.enum.SIGNED;

    if (
      nextStatus === SIGNING_STATUS_SCHEMA.enum.SIGNED &&
      getAgreementResponseSignedState(agreementResponse.signingStatus)
    ) {
      return NextResponse.json({ ok: true });
    }

    await syncAgreementResponseWithSigningDocument({
      agreementResponseId: agreementResponse.id,
      documentId,
      signingStatus: nextStatus,
    });

    waitUntil(
      mirrorSignedAgreementToStorage({
        agreementResponseId: agreementResponse.id,
      }).catch((error) => {
        console.error(
          "[signing] background mirror of signed agreement failed",
          error,
        );
      }),
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[signing] webhook handler failed", error);
    // Never echo the internal error message — Documenso retry logs could leak SDK/database details.
    return NextResponse.json(
      { message: "Internal Server Error" },
      { status: 500 },
    );
  }
}
