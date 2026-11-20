import { teamPlanIsDataroomPlusTier } from "@/lib/billing/team-plan-custom-messaging";

import { getFeatureFlags } from "@/lib/featureFlags";

/**
 * Freeze Data Room — and the downloadable tamper-proof archive it generates —
 * is included on the Data Rooms Plus tier and above. The Edge Config
 * `dataroomFreeze` flag is an additional enablement path layered on top of the
 * plan gate, so the feature can be turned on for a team on the base Data Rooms
 * plan without upgrading. Enabled = Plus-tier plan OR the `dataroomFreeze`
 * flag. Mirrors resolveDataroomIndexEnabledForViewer.
 */
export async function resolveDataroomFreezeEnabled(opts: {
  teamId: string | null | undefined;
  teamPlan: string | null | undefined;
}): Promise<boolean> {
  // Plan check first: cheap, and short-circuits the Edge Config lookup for
  // teams whose plan already includes the feature.
  if (teamPlanIsDataroomPlusTier(opts.teamPlan ?? undefined)) {
    return true;
  }

  const flags = await getFeatureFlags({ teamId: opts.teamId || undefined });
  return Boolean(flags.dataroomFreeze);
}
