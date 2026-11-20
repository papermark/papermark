import { useCallback } from "react";

import { useTeam } from "@/context/team-context";
import useSWR from "swr";

import { SlackChannel } from "@/lib/integrations/slack/types";
import { fetcher } from "@/lib/utils";

type SlackChannelsResponse = { channels: SlackChannel[] };

export function useSlackChannels({ enabled = true }: { enabled?: boolean }) {
  const { currentTeamId: teamId } = useTeam();
  const { data, error, isLoading, mutate } = useSWR<SlackChannelsResponse>(
    enabled && teamId
      ? `/api/teams/${teamId}/integrations/slack/channels`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
      revalidateIfStale: false,
      errorRetryCount: 2,
      errorRetryInterval: 5000,
    },
  );

  // Force a fresh fetch from Slack, bypassing the server-side cache, and write
  // the result back into the SWR cache without an extra revalidation.
  const refresh = useCallback(async () => {
    if (!teamId) return;
    const res = await fetcher(
      `/api/teams/${teamId}/integrations/slack/channels?refresh=true`,
    );
    await mutate(res as SlackChannelsResponse, { revalidate: false });
  }, [teamId, mutate]);

  return {
    channels: data?.channels || [],
    error,
    loading: isLoading && !data,
    mutate,
    refresh,
  };
}
