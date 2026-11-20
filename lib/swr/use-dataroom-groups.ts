import { useRouter } from "next/router";

import { useTeam } from "@/context/team-context";
import {
  Link,
  Viewer,
  ViewerGroup,
  ViewerGroupAccessControls,
  ViewerGroupMembership,
  ViewerInvitation,
} from "@prisma/client";
import useSWR from "swr";

import { fetcher } from "@/lib/utils";

import { LinkWithViews } from "../types";

export default function useDataroomGroups({
  documentId,
  folderId,
  dataroomId: dataroomIdOverride,
}: {
  documentId?: string;
  folderId?: string;
  dataroomId?: string;
} = {}) {
  const teamInfo = useTeam();
  const router = useRouter();

  const { id: queryDataroomId } = router.query as {
    id?: string;
  };
  const id = dataroomIdOverride ?? queryDataroomId;
  const isDataroom =
    router.pathname.includes("datarooms") || !!dataroomIdOverride;

  type ViewerGroupWithCount = ViewerGroup & {
    accessControls: ViewerGroupAccessControls[];
    _count: {
      members: number;
      views: number;
    };
  };

  // Build the optional scope query — at most one of documentId/folderId is
  // expected (the API picks the first one it sees).
  const scopeQuery = documentId
    ? `?documentId=${documentId}`
    : folderId
      ? `?folderId=${folderId}`
      : "";

  const {
    data: viewerGroups,
    error,
    mutate,
  } = useSWR<ViewerGroupWithCount[]>(
    teamInfo?.currentTeam?.id &&
      id &&
      isDataroom &&
      `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${id}/groups${scopeQuery}`,
    fetcher,
    { dedupingInterval: 30000 },
  );

  return {
    viewerGroups,
    loading: !viewerGroups && !error,
    error,
    mutate,
  };
}

export function useDataroomGroupLinks() {
  const router = useRouter();

  const { id, groupId } = router.query as {
    id: string;
    groupId: string;
  };

  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: links, error } = useSWR<LinkWithViews[]>(
    teamId &&
      id &&
      `/api/teams/${teamId}/datarooms/${id}/groups/${groupId}/links`,
    fetcher,
    { dedupingInterval: 10000 },
  );

  return {
    links,
    loading: !error && !links,
    error,
  };
}

type ViewerGroupWithMembers = ViewerGroup & {
  members: (ViewerGroupMembership & { viewer: Viewer & { invitations?: ViewerInvitation[] } })[];
  accessControls: ViewerGroupAccessControls[];
};

export function useDataroomGroup() {
  const router = useRouter();
  const { id, groupId } = router.query as {
    id: string;
    groupId: string;
  };

  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const {
    data: viewerGroup,
    error,
    mutate,
  } = useSWR<ViewerGroupWithMembers>(
    teamId &&
      id &&
      groupId &&
      `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${id}/groups/${groupId}`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    },
  );

  return {
    viewerGroup,
    viewerGroupMembers: viewerGroup?.members ?? [],
    viewerGroupDomains: viewerGroup?.domains ?? [],
    viewerGroupAllowAll: viewerGroup?.allowAll ?? false,
    viewerGroupPermissions: viewerGroup?.accessControls ?? [],
    loading: !viewerGroup && !error,
    error,
    mutate,
  };
}

export function useDataroomGroupPermissions() {
  const router = useRouter();
  const { id, groupId } = router.query as {
    id: string;
    groupId: string;
  };

  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: viewerGroupPermissions, error } = useSWR<
    ViewerGroupAccessControls[]
  >(
    teamId &&
      id &&
      groupId &&
      `/api/teams/${teamId}/datarooms/${id}/groups/${groupId}/permissions`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    },
  );

  return {
    viewerGroupPermissions,
    loading: !viewerGroupPermissions && !error,
    error,
  };
}
