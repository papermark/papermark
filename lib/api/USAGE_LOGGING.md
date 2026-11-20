# API usage logging

Every public-API request emits one **metadata-only** usage event from
`withTeam()` via `lib/api/usage.ts` (`emitApiUsage`). No request bodies, query
values, or path-param values are ever logged.

## Event shape

`request_id, timestamp, team_id, token_id, user_id, subject_type, source,
plan, mode, client, client_version, client_host, method, route, status,
duration_ms, scopes_required, error_code`

- `client` — `cli` | `mcp` | `mcp-remote` | `api` (raw HTTP) | `other`, from the
  `x-papermark-client` header the CLI/MCP send.
- `client_host` — for MCP, the host the agent runs in (`claude.ai`, `cursor`, …).
- `route` — low-cardinality template, e.g. `/api/v1/links/:id`.
- Every response also carries an `x-request-id` header matching `request_id`.

## Sinks (both optional, inert until configured)

Configured via env (see `.env.example`). With neither set, events fall back to
a `[api-usage]` stdout line (also emitted in dev or when `API_USAGE_STDOUT=1`).

- **Axiom** (`AXIOM_TOKEN`, `AXIOM_DATASET`, optional `AXIOM_EDGE`) — raw events
  for search, dashboards, alerts, via the official `@axiomhq/js` client.
  Ingested with `_time = timestamp`. Set `AXIOM_EDGE` to a region edge domain
  (e.g. `eu-central-1.aws.edge.axiom.co`) for EU residency; leave blank for the
  US default. The client batches; we flush per request via Next's `after()` so
  events survive a serverless freeze.
- **PostHog** (`NEXT_PUBLIC_POSTHOG_KEY`) — `api_request` events attributed to
  the team via group analytics (`$groups.team`). Only team-attributed requests
  are sent. Fire-and-forget `fetch` with `keepalive: true`.

## Starter Axiom (APL) queries — answering the four questions

Requests per team (last 7d):
```
['papermark-api'] | where _time > ago(7d)
| summarize requests = count() by team_id | sort by requests desc
```

By client + host ("from which clients"):
```
['papermark-api'] | where _time > ago(7d)
| summarize requests = count() by client, client_host | sort by requests desc
```

Top routes per team ("what calls"):
```
['papermark-api'] | where _time > ago(7d)
| summarize requests = count() by team_id, route | sort by requests desc
```

Active teams (WAU) + by client:
```
['papermark-api'] | where _time > ago(7d)
| summarize teams = dcount(team_id) by client
```

Error rate by route (last 24h):
```
['papermark-api'] | where _time > ago(24h)
| summarize total = count(), errors = countif(status >= 400) by route
| extend error_rate = round(100.0 * errors / total, 1) | sort by error_rate desc
```

p50/p95 latency by route:
```
['papermark-api'] | where _time > ago(24h)
| summarize p50 = percentile(duration_ms, 50), p95 = percentile(duration_ms, 95) by route
```

## PostHog setup

1. Create a **group type** named `team` (Project settings → Groups).
2. Build insights on the `api_request` event, breaking down by group `team`.
   - Active teams = unique `team` groups over the period.
   - Adoption by client = breakdown by the `client` property.
   - Retention = group-based retention on `team`.

## Suggested Axiom monitors (Phase 3)

- 5xx spike: `countif(status >= 500)` over 5m above a threshold.
- Per-team abuse: a single `team_id` exceeding N requests/min.
- Error-rate by route crossing a threshold.
