import type { NextRequest } from "next/server";

import { Axiom } from "@axiomhq/js";
import { waitUntil } from "@vercel/functions";

import type { ErrorCode } from "@/lib/api/errors";

// One structured event per public-API request. Metadata only — never request
// bodies, query values, or path-param values — so it's safe to ship to an
// analytics sink without a PII review.
export interface ApiUsageEvent {
  /** Correlates this log line with the response's `x-request-id` header. */
  request_id: string;
  timestamp: string;
  /** Null when auth failed before a token resolved (e.g. bad/missing bearer). */
  team_id: string | null;
  token_id: string | null;
  user_id: string | null;
  subject_type: string | null;
  /** How the token was issued: `dashboard` | `oauth`. */
  source: string | null;
  plan: string | null;
  /** `live` | `test`. */
  mode: string | null;
  /** Which caller: `cli` | `mcp` | `mcp-remote` | `api` (raw) | `other`. */
  client: string;
  client_version: string | null;
  /** MCP host the agent runs in (claude.ai, cursor, …); null for non-MCP. */
  client_host: string | null;
  method: string;
  /** Route template, e.g. `/api/v1/links/:id` — never the populated path. */
  route: string;
  status: number;
  duration_ms: number;
  /** Scopes the endpoint required (what permission the call exercised). */
  scopes_required: string[];
  /** Error code on failure, else null. */
  error_code: ErrorCode | null;
}

// Bounded, log-injection-safe label: lowercased, charset-restricted, capped.
// Returns null for empty/invalid input so we never emit blanks.
function sanitizeLabel(
  raw: string | null | undefined,
  maxLen = 40,
): string | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, maxLen);
  return cleaned || null;
}

/**
 * Derive the calling client and its version/host from the identification
 * headers the CLI and MCP servers send. Falls back to `api` for raw HTTP
 * callers that send no `x-papermark-client`.
 */
export function readClientIdentity(req: NextRequest): {
  client: string;
  client_version: string | null;
  client_host: string | null;
} {
  return {
    client: sanitizeLabel(req.headers.get("x-papermark-client")) ?? "api",
    client_version: sanitizeLabel(
      req.headers.get("x-papermark-client-version"),
      32,
    ),
    client_host:
      req.headers.get("x-papermark-client-host")?.trim().slice(0, 120) || null,
  };
}

/**
 * Turn the populated request path into a low-cardinality route template by
 * swapping each matched dynamic segment value for `:key`, e.g.
 * `/api/v1/links/abc123` → `/api/v1/links/:id`. Best-effort: good enough for
 * grouping in analytics without threading route metadata through the app.
 */
export function routeTemplate(
  pathname: string,
  params: Record<string, string>,
): string {
  let out = pathname;
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    out = out.split(`/${value}`).join(`/:${key}`);
  }
  return out;
}

// --- Sinks -----------------------------------------------------------------
// Axiom via the official @axiomhq/js client (handles region + batching);
// PostHog via a plain keepalive fetch. Both inert until their env is set.

const AXIOM_TOKEN = process.env.AXIOM_TOKEN;
const AXIOM_DATASET = process.env.AXIOM_DATASET;
// AXIOM_EDGE: region edge domain, e.g. `eu-central-1.aws.edge.axiom.co`; unset → US.
const AXIOM_EDGE = process.env.AXIOM_EDGE;

const axiom =
  AXIOM_TOKEN && AXIOM_DATASET
    ? new Axiom({
        token: AXIOM_TOKEN,
        ...(AXIOM_EDGE ? { edge: AXIOM_EDGE } : {}),
      })
    : null;

// Reuses the app's existing project key; posts to the PostHog EU region
// (matches the browser proxy target in lib/middleware/posthog.ts).
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = "https://eu.i.posthog.com";

function hasSinkConfigured(): boolean {
  return Boolean(axiom || POSTHOG_KEY);
}

// Raw request events → Axiom. `_time` marks the event timestamp; the flush is
// wrapped in waitUntil so the batched event survives a post-response
// serverless freeze (off-Vercel it just runs in the background).
function sendToAxiom(event: ApiUsageEvent): void {
  if (!axiom || !AXIOM_DATASET) return;
  try {
    axiom.ingest(AXIOM_DATASET, [{ _time: event.timestamp, ...event }]);
    // .catch before waitUntil: a flush rejection is async, so the try/catch
    // here (sync only) wouldn't swallow it.
    waitUntil(axiom.flush().catch(() => {}));
  } catch {
    // never let a sink break a request
  }
}

/**
 * Await delivery of any queued Axiom events. No-op when Axiom isn't
 * configured. Useful for graceful shutdown and for scripts/tests that emit
 * events and need to guarantee they land before the process exits.
 */
export async function flushUsage(): Promise<void> {
  if (axiom) await axiom.flush();
}

// Higher-level product view → PostHog, attributed to the team via group
// analytics. Only team-attributed requests are sent (anonymous auth failures
// have no team to group under and would just be noise here).
async function sendToPostHog(event: ApiUsageEvent): Promise<void> {
  if (!POSTHOG_KEY || !event.team_id) return;
  await fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: POSTHOG_KEY,
      event: "api_request",
      distinct_id: `team:${event.team_id}`,
      timestamp: event.timestamp,
      properties: {
        $groups: { team: event.team_id },
        client: event.client,
        client_version: event.client_version,
        client_host: event.client_host,
        method: event.method,
        route: event.route,
        status: event.status,
        duration_ms: event.duration_ms,
        plan: event.plan,
        source: event.source,
        mode: event.mode,
        error_code: event.error_code,
        $insert_id: event.request_id,
      },
    }),
    keepalive: true,
  });
}

/**
 * Emit a usage event. Fire-and-forget and fully self-contained: never throws,
 * never blocks the response. Fans out to Axiom + PostHog when configured and
 * falls back to a structured stdout line otherwise (or in development, or when
 * API_USAGE_STDOUT=1) so events are never silently dropped.
 */
export function emitApiUsage(event: ApiUsageEvent): void {
  try {
    sendToAxiom(event);
    // waitUntil so the delivery fetch survives a post-response serverless
    // freeze — keepalive alone doesn't guarantee completion in the Node runtime.
    waitUntil(sendToPostHog(event).catch(() => {}));

    if (
      !hasSinkConfigured() ||
      process.env.NODE_ENV !== "production" ||
      process.env.API_USAGE_STDOUT === "1"
    ) {
      console.log(`[api-usage] ${JSON.stringify(event)}`);
    }
  } catch {
    // Logging must never break a request.
  }
}

export interface LogApiRequestInput {
  req: NextRequest;
  params: Record<string, string>;
  requestId: string;
  startedAt: number;
  status: number;
  scopesRequired: readonly string[];
  errorCode?: ErrorCode | null;
  token?: {
    tokenId: string;
    userId: string;
    teamId: string;
    subjectType: string;
    source: string;
    mode: string;
  } | null;
  plan?: string | null;
}

/** Assemble an {@link ApiUsageEvent} from request context and emit it. */
export function logApiRequest(input: LogApiRequestInput): void {
  const { req, params, token } = input;
  const identity = readClientIdentity(req);
  emitApiUsage({
    request_id: input.requestId,
    timestamp: new Date().toISOString(),
    team_id: token?.teamId ?? null,
    token_id: token?.tokenId ?? null,
    user_id: token?.userId ?? null,
    subject_type: token?.subjectType ?? null,
    source: token?.source ?? null,
    plan: input.plan ?? null,
    mode: token?.mode ?? null,
    client: identity.client,
    client_version: identity.client_version,
    client_host: identity.client_host,
    method: req.method,
    route: routeTemplate(req.nextUrl.pathname, params),
    status: input.status,
    duration_ms: Math.max(0, Date.now() - input.startedAt),
    scopes_required: [...input.scopesRequired],
    error_code: input.errorCode ?? null,
  });
}
