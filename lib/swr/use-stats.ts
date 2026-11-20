import { useRouter } from "next/router";

import { useTeam } from "@/context/team-context";
import { View } from "@prisma/client";
import useSWR from "swr";
import useSWRImmutable from "swr/immutable";

import { fetcher } from "@/lib/utils";

export type TStatsData = {
  views: View[];
  avgCompletionRate: number;
  duration: {
    data: { versionNumber: number; pageNumber: string; avg_duration: number }[];
  };
  total_duration: number;
  totalViews: number;
};

export function useStats({
  excludeTeamMembers,
  documentId,
  dataroomId,
}: {
  excludeTeamMembers?: boolean;
  documentId?: string;
  /**
   * When provided, stats are scoped to this data room's visits only (e.g. the
   * dataroom-scoped document page), excluding the document's direct-link visits.
   */
  dataroomId?: string;
} = {}) {
  // this gets the data for a document's graph of all views
  const router = useRouter();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { id: routerId } = router.query as {
    id: string;
  };

  // Allow an explicit documentId (e.g. the dataroom-scoped document page where
  // router.query.id is the dataroom id, not the document id).
  const id = documentId ?? routerId;

  const query = new URLSearchParams();
  if (excludeTeamMembers) query.set("excludeTeamMembers", "true");
  if (dataroomId) query.set("dataroomId", dataroomId);
  const queryString = query.toString();

  const { data: stats, error } = useSWR<TStatsData>(
    id &&
      teamId &&
      `/api/teams/${teamId}/documents/${encodeURIComponent(id)}/stats${queryString ? `?${queryString}` : ""}`,
    fetcher,
    {
      dedupingInterval: 10000,
    },
  );

  return {
    stats,
    loading: !error && !stats,
    error,
  };
}

interface StatsViewData {
  views: View[];
  duration: {
    data: { pageNumber: string; sum_duration: number }[];
  };
}

export function useVisitorStats(viewId: string, documentIdOverride?: string) {
  // this gets the data for a single visitor's graph
  const router = useRouter();
  const teamInfo = useTeam();

  const { id: routerId } = router.query as {
    id: string;
  };

  // Allow an explicit documentId (e.g. the dataroom-scoped document page where
  // router.query.id is the dataroom id, not the document id).
  const documentId = documentIdOverride ?? routerId;

  const { data: stats, error } = useSWR<StatsViewData>(
    documentId &&
      viewId &&
      `/api/teams/${teamInfo?.currentTeam?.id}/documents/${encodeURIComponent(
        documentId,
      )}/views/${encodeURIComponent(viewId)}/stats`,
    fetcher,
    {
      dedupingInterval: 10000,
    },
  );

  return {
    stats,
    loading: !error && !stats,
    error,
  };
}

export function useVisitorUserAgent(
  viewId: string,
  documentIdOverride?: string,
) {
  const router = useRouter();
  const teamInfo = useTeam();

  const { id: routerId } = router.query as {
    id: string;
  };

  // Allow an explicit documentId (e.g. the dataroom-scoped document page where
  // router.query.id is the dataroom id, not the document id).
  const documentId = documentIdOverride ?? routerId;

  const { data: userAgent, error } = useSWRImmutable<{
    country: string;
    city: string;
    os: string;
    browser: string;
    device: string;
  }>(
    documentId &&
      viewId &&
      `/api/teams/${teamInfo?.currentTeam?.id}/documents/${documentId}/views/${viewId}/user-agent`,
    fetcher,
  );

  return {
    userAgent,
    loading: !error && !userAgent,
    error,
  };
}
