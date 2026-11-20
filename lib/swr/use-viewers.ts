import { useRouter } from "next/router";

import { useTeam } from "@/context/team-context";
import { Viewer } from "@prisma/client";
import useSWR from "swr";

import { fetcher } from "@/lib/utils";

import type {
  VisitorAccessSource,
  VisitorStatus,
} from "@/components/visitors/visitor-status-badge";

type ViewerWithStats = {
  id: string | null;
  email: string;
  viewerName: string | null;
  verified: boolean;
  internal: boolean;
  agreement: { name: string; signed: boolean; signedAt: Date | null } | null;
  isDomain: boolean;
  status: VisitorStatus;
  createdAt: Date | null;
  updatedAt: Date | null;
  totalVisits: number;
  documentViews: number;
  downloads: number;
  lastViewed: Date | null;
  invitedAt: Date | null;
  invitationStatus: string | null;
  accessSources: VisitorAccessSource[];
};

type ViewersResponse = {
  viewers: ViewerWithStats[];
  anonymous: { visits: number; lastViewed: Date | null };
  pagination: {
    currentPage: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  sorting: {
    sortBy: string;
    sortOrder: string;
  };
};

export default function useViewers(
  page: number = 1,
  pageSize: number = 10,
  sortBy: string = "lastViewed",
  sortOrder: string = "desc",
  status?: string
) {
  const router = useRouter();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const routerQuery = router.query;
  const searchQuery = routerQuery["search"];

  const queryParams = new URLSearchParams();
  queryParams.append('page', page.toString());
  queryParams.append('pageSize', pageSize.toString());
  queryParams.append('sortBy', sortBy);
  queryParams.append('sortOrder', sortOrder);

  if (searchQuery && typeof searchQuery === 'string') {
    queryParams.append('query', searchQuery);
  }

  if (status && status !== 'all') {
    queryParams.append('status', status);
  }

  const queryString = queryParams.toString();

  const {
    data: response,
    isValidating,
    error,
    mutate,
  } = useSWR<ViewersResponse>(
    teamId
      ? `/api/teams/${teamId}/viewers?${queryString}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
      keepPreviousData: true,
      refreshInterval: 0,
      errorRetryCount: 2,
      errorRetryInterval: 5000,
    },
  );

  return {
    viewers: response?.viewers,
    anonymous: response?.anonymous,
    pagination: response?.pagination,
    sorting: response?.sorting,
    isValidating,
    loading: !response && !error,
    isFiltered: !!searchQuery,
    error,
    mutate,
  };
}
