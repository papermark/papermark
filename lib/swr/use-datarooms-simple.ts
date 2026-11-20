import { useTeam } from "@/context/team-context";
import { Dataroom } from "@prisma/client";
import useSWR from "swr";

import { fetcher } from "@/lib/utils";

export type DataroomSimple = Pick<Dataroom, "id" | "name" | "internalName" | "isFrozen" | "createdAt">;

type DataroomsSimpleResponse = {
  datarooms: DataroomSimple[];
};

/**
 * A lightweight hook for fetching datarooms without filtering or extended data.
 * Use this for simple use cases like dropdowns, sidebars, or modals that only need
 * basic dataroom info (id, name, createdAt).
 *
 * For full features (search, tags, counts), use `useDatarooms` instead.
 */
export default function useDataroomsSimple() {
  const teamInfo = useTeam();

  const { data, error, mutate } = useSWR<DataroomsSimpleResponse>(
    teamInfo?.currentTeam?.id &&
      `/api/teams/${teamInfo?.currentTeam?.id}/datarooms?simple=true`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    },
  );

  return {
    datarooms: data?.datarooms,
    loading: !data && !error,
    error,
    mutate,
  };
}
