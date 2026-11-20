import { useRouter } from "next/router";

import { useTeam } from "@/context/team-context";
import useSWR from "swr";

import { fetcher } from "@/lib/utils";

import type {
  VisitorAccessSource,
  VisitorStatus,
} from "@/components/visitors/visitor-status-badge";

export type DataroomVisitor = {
  id: string | null;
  email: string;
  viewerName: string | null;
  verified: boolean;
  agreement: { name: string; signed: boolean; signedAt: Date | null } | null;
  isDomain: boolean;
  status: VisitorStatus;
  invitedAt: Date | null;
  invitationStatus: string | null;
  accessSources: VisitorAccessSource[];
  createdAt: Date | null;
  updatedAt: Date | null;
  totalVisits: number;
  documentViews: number;
  downloads: number;
  lastViewed: Date | null;
  internal: boolean;
  dataroomName: string;
  linkNames: string[];
  hasVisitedLinks: boolean;
};

export type AnonymousVisitorStats = {
  visits: number;
  lastViewed: Date | null;
};

type DataroomVisitorsResponse = {
  visitors: DataroomVisitor[];
  anonymous: AnonymousVisitorStats;
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

export function useDataroomVisitors({
  dataroomId,
  page = 1,
  pageSize = 10,
  sortBy = "lastViewed",
  sortOrder = "desc",
  status,
}: {
  dataroomId?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: string;
  status?: string;
}) {
  const router = useRouter();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const searchQuery = router.query["search"];

  const queryParams = new URLSearchParams();
  queryParams.append("page", page.toString());
  queryParams.append("pageSize", pageSize.toString());
  queryParams.append("sortBy", sortBy);
  queryParams.append("sortOrder", sortOrder);

  if (searchQuery && typeof searchQuery === "string") {
    queryParams.append("query", searchQuery);
  }

  if (status && status !== "all") {
    queryParams.append("status", status);
  }

  const {
    data: response,
    isValidating,
    error,
    mutate,
  } = useSWR<DataroomVisitorsResponse>(
    teamId && dataroomId
      ? `/api/teams/${teamId}/datarooms/${dataroomId}/visitors?${queryParams.toString()}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
      keepPreviousData: true,
      errorRetryCount: 2,
      errorRetryInterval: 5000,
    },
  );

  return {
    visitors: response?.visitors,
    anonymous: response?.anonymous,
    pagination: response?.pagination,
    sorting: response?.sorting,
    isValidating,
    loading: !response && !error,
    isFiltered: !!searchQuery || (!!status && status !== "all"),
    error,
    mutate,
  };
}
