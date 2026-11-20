import { useEffect, useRef } from "react";

import { useTeam } from "@/context/team-context";
import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks";
import useSWR, { mutate } from "swr";

import { fetcher } from "@/lib/utils";

interface UseFreezeProgressOptions {
  dataroomId: string | undefined;
  isFrozen: boolean;
  frozenAt: string | Date | null;
  freezeArchiveUrl: string | null;
  initialToken?: string;
}

export function useFreezeProgress({
  dataroomId,
  isFrozen,
  frozenAt,
  freezeArchiveUrl,
  initialToken,
}: UseFreezeProgressOptions) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const frozenAtMs = frozenAt ? new Date(frozenAt).getTime() : null;
  const isArchiveInProgress = isFrozen && !freezeArchiveUrl && !!frozenAtMs;

  const { data: tokenData } = useSWR<{
    publicAccessToken: string;
    hasRuns: boolean;
  }>(
    isArchiveInProgress && !initialToken && teamId && dataroomId
      ? `/api/teams/${teamId}/datarooms/${dataroomId}/freeze/monitor-token`
      : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  );

  const accessToken = initialToken || tokenData?.publicAccessToken;
  const tag = `freeze:${dataroomId}:${frozenAtMs}`;

  const { runs } = useRealtimeRunsWithTag(tag, {
    enabled: isArchiveInProgress && !!accessToken,
    accessToken,
  });

  const activeRun = runs.find((r) =>
    ["QUEUED", "EXECUTING"].includes(r.status),
  );
  const completedRun = runs.find((r) => r.status === "COMPLETED");
  const failedRun = runs.find((r) =>
    ["FAILED", "CRASHED", "CANCELED", "SYSTEM_FAILURE"].includes(r.status),
  );

  const noRunsFound =
    isArchiveInProgress &&
    tokenData !== undefined &&
    tokenData.hasRuns === false &&
    runs.length === 0;

  const isFailed =
    isArchiveInProgress && !!failedRun && !completedRun && !activeRun;

  let progress = 0;
  let progressText = "";
  if (activeRun?.metadata) {
    const meta = activeRun.metadata as Record<string, unknown>;
    progress = ((meta.progress as number) ?? 0) * 100;
    progressText = (meta.text as string) ?? "";
  }

  const archiveReady = completedRun?.metadata
    ? !!((completedRun.metadata as Record<string, unknown>).archiveReady)
    : false;

  const hasRevalidated = useRef(false);
  useEffect(() => {
    if (completedRun && teamId && dataroomId && !hasRevalidated.current) {
      hasRevalidated.current = true;
      mutate(`/api/teams/${teamId}/datarooms/${dataroomId}`);
    }
  }, [completedRun, teamId, dataroomId]);

  return {
    isArchiveInProgress: isArchiveInProgress && !completedRun,
    progress,
    progressText,
    archiveReady,
    activeRun,
    completedRun,
    failedRun,
    noRunsFound,
    isFailed,
    runs,
  };
}
