import { useRouter } from "next/router";

import { useTeam } from "@/context/team-context";
import useSWR from "swr";
import { useMemo } from "react";

import { fetcher } from "@/lib/utils";

import type { VisitorRecord } from "@/lib/api/visitors/get-visitors";

type ViewerWithViews = {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
  access?: VisitorRecord | null;
  views: {
    documentId: string;
    viewCount: number;
    lastViewed: Date;
    document: {
      id: string;
      name: string | null;
      type: string | null;
      contentType: string | null;
    };
    totalDuration: number;
  }[];
  pagination?: {
    currentPage: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  sorting?: {
    sortBy: string;
    sortOrder: string;
  };
};

export default function useViewer(
  page: number = 1,
  pageSize: number = 10,
  sortBy: string = "lastViewed",
  sortOrder: string = "desc"
) {
  const router = useRouter();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { id } = router.query;

  const queryParams = new URLSearchParams();
  queryParams.append('page', page.toString());
  queryParams.append('pageSize', pageSize.toString());
  queryParams.append('sortBy', sortBy);
  queryParams.append('sortOrder', sortOrder);
  const queryString = queryParams.toString();

  const { data: viewer, error } = useSWR<ViewerWithViews>(
    teamId && id ? `/api/teams/${teamId}/viewers/${id}?${queryString}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
      revalidateIfStale: false,
    }
  );

  const shouldFetchDurations = (viewer?.views?.length ?? 0) > 0;

  const { data: durationsResponse, isLoading: loadingDurations, error: durationsError } = useSWR<{ durations: Record<string, number> }>(
    shouldFetchDurations
      ? `/api/teams/${teamId}/viewers/${id}?${queryString}&withDuration=true`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
      errorRetryCount: 1,
      errorRetryInterval: 5000,
      revalidateIfStale: false,
    }
  );

  const durations = useMemo(() => {
    return durationsResponse?.durations || {};
  }, [durationsResponse]);

  const isMainLoading = !viewer && !error;
  const isDurationsLoading = shouldFetchDurations && loadingDurations && !durationsError;

  return {
    viewer, // Always use the main viewer data
    durations,
    loadingDurations: isDurationsLoading,
    loading: isMainLoading,
    error: error || durationsError,
    hasData: Boolean(viewer),
  };
}
