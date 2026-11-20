import { useTeam } from "@/context/team-context";
import { View } from "@prisma/client";
import useSWR from "swr";

import { fetcher } from "@/lib/utils";

interface ViewWithDuration extends View {
  duration: {
    data: { pageNumber: string; sum_duration: number }[];
  };
  totalDuration: number;
  completionRate: number;
}

interface LinkVisitsResponse {
  views: ViewWithDuration[];
  hiddenFromPause: number;
}

export function useLinkVisits(linkId: string) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { data, error } = useSWR<LinkVisitsResponse>(
    linkId &&
      teamId &&
      `/api/teams/${teamId}/links/${encodeURIComponent(linkId)}/visits`,
    fetcher,
    {
      dedupingInterval: 10000,
    },
  );

  return {
    views: data?.views,
    hiddenFromPause: data?.hiddenFromPause ?? 0,
    loading: !error && !data,
    error,
  };
}
