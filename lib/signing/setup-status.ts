/**
 * Shared contract for the signing-template setup status endpoint.
 *
 * The `/signing/setup-status` route reports the state of the Trigger.dev run
 * that provisions a Documenso template. The client watches this run through
 * Trigger.dev Realtime, but realtime delivery is best-effort (it can be blocked
 * by restrictive networks/proxies, dropped, or lag behind). To keep "Continue
 * to field placement" from hanging forever, the client also polls this route,
 * so the shapes below are the single source of truth for both sides.
 */

export const DEFAULT_SIGNING_SETUP_FAILURE_MESSAGE =
  "Failed to start the signing template authoring flow.";

export const DEFAULT_SIGNING_SETUP_STATUS_TEXT = "Preparing signing template...";

export type SigningSetupEmbedPayload = {
  presignToken: string;
  expiresAt: string;
  externalId: string | null;
  envelopeId: string;
  host: string;
};

/** Resolved decision the client acts on after reading the status endpoint. */
export type SigningSetupResolution =
  | { state: "pending"; text?: string }
  | { state: "completed"; setup: SigningSetupEmbedPayload }
  | { state: "failed"; message: string };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

/** Pull the human-readable progress text the task publishes via run metadata. */
export const extractSetupStatusText = (metadata: unknown): string | undefined => {
  const status = asRecord(asRecord(metadata)?.status);
  const text = status?.text;
  return typeof text === "string" && text.trim().length > 0 ? text : undefined;
};

const isEmbedPayload = (
  record: Record<string, unknown> | null,
): record is Record<string, unknown> & SigningSetupEmbedPayload =>
  !!record &&
  typeof record.presignToken === "string" &&
  record.presignToken.length > 0 &&
  typeof record.envelopeId === "string" &&
  record.envelopeId.length > 0 &&
  typeof record.host === "string" &&
  record.host.length > 0;

/**
 * Map an HTTP status + parsed body from `/signing/setup-status` to a decision.
 *
 * The mapping is intentionally conservative so a transient hiccup never
 * discards a run that may still succeed:
 * - `202` and any incomplete `2xx` mean "still working" (keep waiting).
 * - `5xx` and unparseable responses are treated as transient (keep waiting).
 * - Only an explicit `state: "failed"` payload or a `4xx` is terminal.
 */
export const resolveSigningSetupResponse = (
  httpStatus: number,
  body: unknown,
): SigningSetupResolution => {
  const record = asRecord(body);

  if (httpStatus === 202) {
    return { state: "pending", text: extractSetupStatusText(record?.metadata) };
  }

  if (httpStatus >= 200 && httpStatus < 300) {
    if (record?.state === "failed") {
      const message =
        typeof record.message === "string" && record.message.trim().length > 0
          ? record.message
          : DEFAULT_SIGNING_SETUP_FAILURE_MESSAGE;
      return { state: "failed", message };
    }

    if (isEmbedPayload(record)) {
      return {
        state: "completed",
        setup: {
          presignToken: record.presignToken,
          expiresAt:
            typeof record.expiresAt === "string" ? record.expiresAt : "",
          externalId:
            typeof record.externalId === "string" ? record.externalId : null,
          envelopeId: record.envelopeId,
          host: record.host,
        },
      };
    }

    // A 2xx without a usable embed payload means the run finished replicating
    // but the provider token is not ready yet — keep waiting instead of
    // rendering the editor with an empty envelope.
    return { state: "pending", text: extractSetupStatusText(record?.metadata) };
  }

  // Server-side blips (or the Trigger.dev API being briefly unreachable) are
  // transient: keep polling until the watchdog trips rather than failing early.
  if (httpStatus >= 500) {
    return { state: "pending" };
  }

  // 4xx responses are terminal (bad request, unauthorized, not found, etc.).
  const message =
    typeof body === "string" && body.trim().length > 0
      ? body
      : DEFAULT_SIGNING_SETUP_FAILURE_MESSAGE;
  return { state: "failed", message };
};
