import { useSession } from "next-auth/react";
import useSWR from "swr";

import { Team } from "@/lib/types";
import { fetcher } from "@/lib/utils";

export function useTeams() {
  const { data: session } = useSession();

  const { data: teams, isValidating } = useSWR<Team[]>(
    session ? "/api/teams" : null,
    fetcher,
    {
      dedupingInterval: 20000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    },
  );

  return {
    teams,
    loading: !teams && !!session,
    isValidating,
  };
}
