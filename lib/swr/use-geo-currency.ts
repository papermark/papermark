import useSWR from "swr";

import type { Currency } from "@/ee/stripe/currency";

import { fetcher } from "@/lib/utils";

// Resolves the visitor's default billing currency from their IP geolocation
// (EUR for European countries, USD otherwise). Returns `undefined` while
// loading so callers can fall back to a sensible default.
export function useGeoCurrency(): Currency | undefined {
  const { data } = useSWR<{ country: string | null; currency: Currency }>(
    "/api/geo/currency",
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      dedupingInterval: 60 * 60 * 1000,
    },
  );
  return data?.currency;
}
