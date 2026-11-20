import { useMemo } from "react";

import { useSession } from "next-auth/react";

import { useGetTeam } from "@/lib/swr/use-team";
import { CustomUser, TeamRole } from "@/lib/types";

export interface SelfMembership {
  role: TeamRole | null;
  isDataroomMember: boolean;
  allowedDataroomIds: string[];
  loading: boolean;
}

/**
 * Returns the current user's membership scope within the active team:
 * their role, whether they are a dataroom-scoped member, and the dataroom ids
 * they are assigned to. Mirrors `useIsAdmin()` and reuses the SWR-cached team.
 */
export function useSelfMembership(): SelfMembership {
  const { data: session, status } = useSession();
  const { team, loading: teamLoading } = useGetTeam();

  const sessionLoading = status === "loading";
  const loading = teamLoading || sessionLoading;

  const userId = (session?.user as CustomUser)?.id;

  return useMemo(() => {
    const membership = team?.users?.find((u) => u.userId === userId);
    const role = (membership?.role as TeamRole | undefined) ?? null;
    const isDataroomMember = role === "DATAROOM_MEMBER";
    const allowedDataroomIds = isDataroomMember
      ? (team?.userDatarooms ?? [])
          .filter((ud) => ud.userId === userId)
          .map((ud) => ud.dataroomId)
      : [];

    return {
      role,
      isDataroomMember: !loading && isDataroomMember,
      allowedDataroomIds,
      loading,
    };
  }, [team, userId, loading]);
}
