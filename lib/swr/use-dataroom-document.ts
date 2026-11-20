import { useRouter } from "next/router";

import { useTeam } from "@/context/team-context";
import useSWR from "swr";

import { DocumentWithVersion } from "@/lib/types";
import { fetcher } from "@/lib/utils";

interface DataroomDocumentOverview {
  dataroomDocumentId: string;
  documentId: string;
  dataroom: { id: string; name: string };
  dataroomFolder: { id: string; name: string; path: string } | null;
  document: DocumentWithVersion & {
    hasPageLinks: boolean;
    isEmpty: boolean;
    primaryVersion: any;
  };
  limits: {
    canAddLinks: boolean;
    canAddDocuments: boolean;
    canAddUsers: boolean;
  };
  featureFlags: {
    annotations: boolean;
  };
  team: {
    plan: string;
    isTrial: boolean;
  };
  counts: {
    links: number;
    views: number;
    /**
     * Number of direct document-link visits (no data room). Only populated for
     * full team members; always 0 for dataroom-scoped members.
     */
    otherViewCount: number;
  };
}

/**
 * Loads a single document's overview from within a data room, addressed by the
 * DataroomDocument id. Uses the dataroom-scoped endpoint so dataroom-scoped
 * members can read it. Resolves to the underlying Document id, which the page
 * threads into the existing (scope-guarded) document endpoints.
 */
export function useDataroomDocumentOverview() {
  const router = useRouter();
  const teamInfo = useTeam();

  const { id: dataroomId, documentId: dataroomDocumentId } =
    router.query as {
      id: string;
      documentId: string;
    };

  const teamId = teamInfo?.currentTeam?.id;

  const { data, error, mutate } = useSWR<DataroomDocumentOverview>(
    teamId &&
      dataroomId &&
      dataroomDocumentId &&
      `/api/teams/${teamId}/datarooms/${dataroomId}/documents/${encodeURIComponent(
        dataroomDocumentId,
      )}/overview`,
    fetcher,
    {
      dedupingInterval: 30000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      refreshInterval: 0,
      onError: (err) => {
        if (err.status === 404) {
          router.replace(`/datarooms/${dataroomId}/documents`);
        }
      },
    },
  );

  return {
    data,
    documentId: data?.documentId,
    dataroomDocumentId: data?.dataroomDocumentId,
    dataroom: data?.dataroom,
    document: data?.document,
    primaryVersion: data?.document?.primaryVersion,
    limits: data?.limits,
    featureFlags: data?.featureFlags,
    team: data?.team,
    counts: data?.counts,
    isEmpty: data?.document?.isEmpty || false,
    loading: !error && !data,
    error,
    mutate,
  };
}
