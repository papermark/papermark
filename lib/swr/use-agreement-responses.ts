import { useTeam } from "@/context/team-context";
import useSWR from "swr";

import { fetcher } from "@/lib/utils";

export interface AgreementResponseSummary {
  id: string;
  signingStatus: string;
  signingEnvelopeId: string | null;
  signingExternalId: string | null;
  signedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  // Captured from the access form / signing provider, even when the visitor abandons before a View exists.
  linkId: string | null;
  signerEmail: string | null;
  signerName: string | null;
  // Hydrated server-side when there's no View but a linkId, so the UI can show the originating link.
  link: {
    id: string;
    name: string | null;
  } | null;
  view: {
    id: string;
    viewerEmail: string | null;
    viewerName: string | null;
    viewedAt: string;
    linkId: string;
    link: {
      id: string;
      name: string | null;
    } | null;
    document: {
      id: string;
      name: string;
    } | null;
    dataroom: {
      id: string;
      name: string;
    } | null;
  } | null;
}

export interface AgreementResponsesPayload {
  agreement: {
    id: string;
    name: string;
    contentType: string;
    signingProvider: string;
    isSigning: boolean;
  };
  responses: AgreementResponseSummary[];
}

const EMPTY_RESPONSES: AgreementResponseSummary[] = [];

export function useAgreementResponses(agreementId?: string | null) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data, error, mutate, isLoading } = useSWR<AgreementResponsesPayload>(
    teamId && agreementId
      ? `/api/teams/${teamId}/agreements/${agreementId}/responses`
      : null,
    fetcher,
    {
      dedupingInterval: 30000,
      revalidateOnFocus: false,
      keepPreviousData: true,
    },
  );

  return {
    agreement: data?.agreement,
    responses: data?.responses ?? EMPTY_RESPONSES,
    loading: isLoading,
    error,
    mutate,
  };
}
