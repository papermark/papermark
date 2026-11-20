import { useTeam } from "@/context/team-context";
import useSWR from "swr";

import { fetcher } from "@/lib/utils";

export type DocumentViewStats = {
  viewId: string;
  documentId: string;
  totalDuration: number;
  pagesViewed: number;
  totalPages: number;
  completionRate: number;
  documentType?: string | null;
};

export function useDataroomViewDocumentStats({
  dataroomId,
  dataroomViewId,
  enabled = false,
}: {
  dataroomId: string;
  dataroomViewId: string;
  enabled?: boolean;
}) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const canFetch = !!(enabled && teamId && dataroomId && dataroomViewId);

  const { data, error } = useSWR<{ documentStats: DocumentViewStats[] }>(
    canFetch
      ? `/api/teams/${teamId}/datarooms/${dataroomId}/views/${dataroomViewId}/document-stats`
      : null,
    fetcher,
    {
      dedupingInterval: 30000,
      revalidateOnFocus: false,
    },
  );

  return {
    documentStats: data?.documentStats,
    loading: canFetch && !error && !data,
    error,
  };
}

type PageDurationData = {
  pageNumber: string;
  sum_duration: number;
};

export function useDataroomDocumentPageStats({
  dataroomId,
  dataroomViewId,
  documentViewId,
  documentId,
  enabled = false,
}: {
  dataroomId: string;
  dataroomViewId: string;
  documentViewId: string;
  documentId: string;
  enabled?: boolean;
}) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const canFetch = !!(
    enabled && teamId && dataroomId && dataroomViewId && documentViewId && documentId
  );

  const { data, error } = useSWR<{ duration: { data: PageDurationData[] } }>(
    canFetch
      ? `/api/teams/${teamId}/datarooms/${dataroomId}/views/${dataroomViewId}/document-stats?documentViewId=${documentViewId}&documentId=${documentId}`
      : null,
    fetcher,
    {
      dedupingInterval: 30000,
      revalidateOnFocus: false,
    },
  );

  return {
    duration: data?.duration,
    loading: canFetch && !error && !data,
    error,
  };
}
