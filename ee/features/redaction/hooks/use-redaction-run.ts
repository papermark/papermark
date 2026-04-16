"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Metadata shape emitted by the detect-redactions / apply-redactions tasks.
 */
export type RedactionRunMetadata = {
  status?:
    | "pending"
    | "detecting"
    | "review"
    | "applying"
    | "applied"
    | "failed";
  step?: string;
  progress?: number;
  pagesProcessed?: number;
  totalPages?: number;
  redactionsFound?: number;
};

type RunStatusResponse = {
  id: string;
  status: string;
  metadata?: RedactionRunMetadata;
  isCompleted: boolean;
  isFailed: boolean;
  output?: Record<string, unknown>;
};

/**
 * Poll the generic run-status endpoint for a redaction run's progress.
 *
 * We reuse the existing `/api/ai/store/runs/:runId` polling route because
 * Trigger.dev runs are team-scoped and that endpoint already enforces
 * team-member authorization. For our tasks we attach `team_<id>` tags via
 * the trigger calls, but the authorization check in that endpoint reads
 * `metadata.teamId`; the redaction tasks don't set that explicitly, so we
 * fall back to polling by run id and rely on the trigger API's own auth.
 */
export function useRedactionRun({
  runId,
  pollInterval = 1500,
}: {
  runId: string | null;
  pollInterval?: number;
}) {
  const [run, setRun] = useState<RunStatusResponse | null>(null);
  const [error, setError] = useState<string | undefined>();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!runId) return;
    try {
      const res = await fetch(`/api/ai/store/runs/${runId}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch run status (${res.status})`);
      }
      const data = (await res.json()) as RunStatusResponse;
      setRun(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId]);

  useEffect(() => {
    if (!runId) return;

    fetchStatus();

    timer.current = setInterval(() => {
      if (run?.isCompleted || run?.isFailed) {
        if (timer.current) clearInterval(timer.current);
        return;
      }
      fetchStatus();
    }, pollInterval);

    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [runId, fetchStatus, pollInterval, run?.isCompleted, run?.isFailed]);

  const metadata = run?.metadata;

  return {
    isCompleted: run?.isCompleted ?? false,
    isFailed: (run?.isFailed ?? false) || metadata?.status === "failed",
    step: metadata?.step,
    progress: metadata?.progress ?? 0,
    status: metadata?.status,
    pagesProcessed: metadata?.pagesProcessed ?? 0,
    totalPages: metadata?.totalPages ?? 0,
    redactionsFound: metadata?.redactionsFound ?? 0,
    error,
    output: run?.output,
  };
}
