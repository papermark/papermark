import { useRouter } from "next/router";

import { useTeam } from "@/context/team-context";
import { View } from "@prisma/client";
import { toast } from "sonner";
import useSWR from "swr";

import { DocumentWithVersion, LinkWithViews } from "@/lib/types";
import { fetcher } from "@/lib/utils";

export function useDocument() {
  const router = useRouter();
  const teamInfo = useTeam();

  const { id } = router.query as {
    id: string;
  };

  const {
    data: document,
    error,
    mutate,
  } = useSWR<DocumentWithVersion>(
    teamInfo?.currentTeam?.id &&
      id &&
      `/api/teams/${teamInfo?.currentTeam?.id}/documents/${encodeURIComponent(
        id,
      )}`,
    fetcher,
    {
      // Reduce background-driven revalidation to avoid excessive API traffic
      dedupingInterval: 30000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      onError: (err) => {
        if (err.status === 404) {
          toast.error("Document not found", {
            description:
              "The document you're looking for doesn't exist or has been moved.",
          });
          router.replace("/documents");
        }
      },
    },
  );

  return {
    document,
    primaryVersion: document?.versions[0],
    loading: !error && !document,
    error,
    mutate,
  };
}

export function useDocumentLinks(documentId?: string) {
  const router = useRouter();
  const teamInfo = useTeam();

  const { id: routerId } = router.query as {
    id: string;
  };

  // Allow an explicit documentId (e.g. the dataroom-scoped document page where
  // router.query.id is the dataroom id, not the document id).
  const id = documentId ?? routerId;

  const {
    data: links,
    error,
    mutate,
  } = useSWR<LinkWithViews[]>(
    teamInfo?.currentTeam?.id &&
      id &&
      `/api/teams/${teamInfo?.currentTeam?.id}/documents/${encodeURIComponent(
        id,
      )}/links`,
    fetcher,
    {
      dedupingInterval: 10000,
    },
  );

  return {
    links,
    loading: !error && !links,
    error,
    mutate,
  };
}

interface ViewWithDuration extends View {
  internal: boolean;
  duration: {
    data: { pageNumber: string; sum_duration: number }[];
  };
  totalDuration: number;
  completionRate: number;
  link: {
    name: string | null;
  };
  feedbackResponse: {
    id: string;
    data: {
      question: string;
      answer: string;
    };
  } | null;
  agreementResponse: {
    id: string;
    agreementId: string;
    signingStatus: string;
    signedAt: string | null;
    completedAt: string | null;
    agreement: {
      name: string;
      contentType: string;
      signingProvider: string;
    };
  } | null;
  versionNumber: number;
  versionNumPages: number;
}

type TStatsData = {
  hiddenViewCount: number;
  viewsWithDuration: ViewWithDuration[];
  totalViews: number;
  hiddenFromPause: number;
};

export function useDocumentVisits(
  page: number,
  limit: number,
  documentId?: string,
  options?: {
    /**
     * Scope the visits to a single data room. Required for the `scope` filter
     * to take effect (the dataroom-scoped document page passes this).
     */
    dataroomId?: string;
    /**
     * `dataroom` → only this room's visits; `other` → only the document's
     * direct-link visits (no data room). Only applies when `dataroomId` is set.
     */
    scope?: "dataroom" | "other";
  },
) {
  const router = useRouter();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { id: routerId } = router.query as {
    id: string;
  };

  // Allow an explicit documentId (e.g. the dataroom-scoped document page where
  // router.query.id is the dataroom id, not the document id).
  const id = documentId ?? routerId;

  const { dataroomId, scope } = options ?? {};

  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (dataroomId) {
    query.set("dataroomId", dataroomId);
    if (scope) query.set("scope", scope);
  }

  const cacheKey =
    teamId && id
      ? `/api/teams/${teamId}/documents/${id}/views?${query.toString()}`
      : null;

  const {
    data: views,
    error,
    mutate,
  } = useSWR<TStatsData>(cacheKey, fetcher, {
    dedupingInterval: 20000,
  });

  return {
    views,
    loading: !error && !views,
    error,
    mutate,
  };
}

interface DocumentProcessingStatus {
  currentPageCount: number;
  totalPages: number;
  hasPages: boolean;
}

export function useDocumentProcessingStatus(documentVersionId: string) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: status, error } = useSWR<DocumentProcessingStatus>(
    teamId &&
      `/api/teams/${teamId}/documents/document-processing-status?documentVersionId=${documentVersionId}`,
    fetcher,
    {
      refreshInterval: 3000, // refresh every 3 seconds
    },
  );

  return {
    status: status,
    loading: !error && !status,
    error: error,
  };
}

export function useDocumentThumbnail(
  pageNumber: number,
  documentId: string,
  versionNumber?: number,
) {
  const { data, error } = useSWR<{ imageUrl: string }>(
    pageNumber === 0
      ? null
      : `/api/jobs/get-thumbnail?documentId=${documentId}&pageNumber=${pageNumber}&versionNumber=${versionNumber}`,
    fetcher,
    {
      dedupingInterval: 1200000,
      revalidateOnFocus: false,
      // revalidateOnMount: false,
      revalidateIfStale: false,
      refreshInterval: 0,
    },
  );

  if (pageNumber === 0) {
    return {
      data: null,
      loading: false,
      error: null,
    };
  }

  return {
    data,
    loading: !error && !data,
    error,
  };
}
