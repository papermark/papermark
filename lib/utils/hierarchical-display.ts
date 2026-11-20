import { useFeatureFlags } from "@/lib/hooks/use-feature-flags";
import { usePlan } from "@/lib/swr/use-billing";

/**
 * Admin-side gate for showing hierarchical index prefixes.
 * Mirrors the viewer rule in `lib/featureFlags/dataroom-index-viewer.ts` and
 * the API gate in `pages/api/teams/[teamId]/datarooms/[id]/calculate-indexes.ts`:
 * Edge Config `dataroomIndex` flag OR Datarooms-Plus tier (incl. premium/unlimited).
 */
export function useDataroomIndexDisplayEnabled(): boolean {
  const { isFeatureEnabled } = useFeatureFlags();
  const { isDataroomsPlus } = usePlan();
  return isFeatureEnabled("dataroomIndex") || isDataroomsPlus;
}

export function useHierarchicalDisplayName(
  name: string,
  hierarchicalIndex?: string | null,
): string {
  const enabled = useDataroomIndexDisplayEnabled();

  if (enabled && hierarchicalIndex) {
    return `${hierarchicalIndex} ${name}`;
  }

  return name;
}

export function getHierarchicalDisplayName(
  name: string,
  hierarchicalIndex?: string | null,
  isFeatureEnabled: boolean = false,
): string {
  if (isFeatureEnabled && hierarchicalIndex) {
    return `${hierarchicalIndex} ${name}`;
  }

  return name;
}

export const HIERARCHICAL_DISPLAY_STYLE = {
  fontVariantNumeric: "tabular-nums" as const,
};
