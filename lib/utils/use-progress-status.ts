"use client";

import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks";

import { parseStatus } from "@/lib/utils/generate-trigger-status";

// INFO: This is the same as the RunStatus type in @trigger.dev/core/v3. Wait until it's exported from the package.
type RunStatus =
  | "PENDING_VERSION"
  | "QUEUED"
  | "DEQUEUED"
  | "EXECUTING"
  | "WAITING"
  | "COMPLETED"
  | "CANCELED"
  | "FAILED"
  | "CRASHED"
  | "SYSTEM_FAILURE"
  | "DELAYED"
  | "EXPIRED"
  | "TIMED_OUT";

interface IDocumentProgressStatus {
  state: RunStatus;
  progress: number;
  text: string;
}

export function useDocumentProgressStatus(
  documentVersionId: string,
  publicAccessToken: string | undefined,
) {
  const { runs, error } = useRealtimeRunsWithTag(
    `version:${documentVersionId}`,
    {
      enabled: !!publicAccessToken,
      accessToken: publicAccessToken,
    },
  );

  // Find the most recent active run (QUEUED or EXECUTING)
  const activeRun = runs.find((run) =>
    ["QUEUED", "EXECUTING", "WAITING"].includes(run.status),
  );

  const status: IDocumentProgressStatus = {
    state: "QUEUED",
    progress: 0,
    text: "Initializing...",
  };

  // If we have no runs at all
  if (runs.length === 0) {
    return { status, error, run: undefined };
  }

  // If we found an active run, use its status
  if (activeRun) {
    status.state = activeRun.status;
    if (activeRun.metadata) {
      const { progress, text } = parseStatus(activeRun.metadata);
      status.progress = progress;
      status.text = text;
    }
    return { status, error, run: activeRun };
  }

  // Check if any run has failed
  const failedRun = runs.find((run) =>
    ["FAILED", "CRASHED", "CANCELED", "SYSTEM_FAILURE"].includes(run.status),
  );

  if (failedRun) {
    status.state = failedRun.status;
    if (failedRun.metadata) {
      const { progress, text } = parseStatus(failedRun.metadata);
      status.progress = progress;
      status.text = text;
    }
    return { status, error, run: failedRun };
  }

  // If all runs are completed
  const allCompleted = runs.every((run) => run.status === "COMPLETED");
  if (allCompleted) {
    status.state = "COMPLETED";
    status.progress = 100;
    status.text = "Processing complete";
  }

  return {
    status,
    error,
    run: runs[0], // Return most recent run
  };
}
