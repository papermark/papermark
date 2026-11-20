import { useTeam } from "@/context/team-context";
import { Brand, DataroomBrand } from "@prisma/client";
import useSWR from "swr";

import { fetcher } from "@/lib/utils";

export type TeamBrandsResponse = {
  brands: Brand[];
  defaultBrandId: string | null;
};

export function useBrand() {
  const teamInfo = useTeam();

  const { data: brand, error } = useSWR<Brand>(
    teamInfo?.currentTeam?.id &&
      `/api/teams/${teamInfo?.currentTeam?.id}/branding`,
    fetcher,
    {
      dedupingInterval: 30000,
    },
  );

  return {
    brand,
    error,
    loading: !error && brand === undefined,
  };
}

export function useBrands() {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data, error, mutate } = useSWR<TeamBrandsResponse>(
    teamId && `/api/teams/${teamId}/brands`,
    fetcher,
    {
      dedupingInterval: 0,
      refreshInterval: 0,
      revalidateOnMount: true,
      revalidateOnFocus: true,
    },
  );

  return {
    brands: data?.brands ?? [],
    defaultBrandId: data?.defaultBrandId ?? null,
    error,
    loading: !data && !error,
    mutate,
  };
}

export type DataroomBrandResponse = {
  brand: DataroomBrand | null;
  dataroomBrandId: string | null;
};

function readDataroomBrandResponse(
  data: DataroomBrandResponse | DataroomBrand | null | undefined,
): {
  brand: DataroomBrand | null | undefined;
  dataroomBrandId: string | null | undefined;
} {
  if (data === undefined) {
    return { brand: undefined, dataroomBrandId: undefined };
  }
  if (data === null) {
    return { brand: null, dataroomBrandId: null };
  }
  if ("brand" in data && !("dataroomId" in data)) {
    return {
      brand: data.brand,
      dataroomBrandId: data.dataroomBrandId ?? null,
    };
  }
  const row = data as DataroomBrand & { dataroomBrandId?: string | null };
  return {
    brand: row,
    dataroomBrandId:
      "dataroomBrandId" in row ? (row.dataroomBrandId ?? null) : undefined,
  };
}

export function useDataroomBrand({
  dataroomId,
}: {
  dataroomId: string | undefined;
}) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data, error } = useSWR<DataroomBrandResponse | DataroomBrand | null>(
    teamId &&
      dataroomId &&
      `/api/teams/${teamId}/datarooms/${dataroomId}/branding`,
    fetcher,
    {
      dedupingInterval: 30000,
    },
  );

  const { brand, dataroomBrandId } = readDataroomBrandResponse(data);

  return {
    brand,
    dataroomBrandId,
    error,
    loading: Boolean(teamId && dataroomId) && !error && data === undefined,
  };
}
