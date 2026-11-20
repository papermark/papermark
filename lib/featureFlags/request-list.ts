import { teamPlanIsDataroomPlusTier } from "@/lib/billing/team-plan-custom-messaging";
import { getFeatureFlags } from "@/lib/featureFlags";

/**
 * Request List ships on the Data Rooms Plus tier and above; the Edge Config
 * `requestList` flag additionally enables it for a team on the base Data Rooms
 * plan. Mirrors resolveDataroomFreezeEnabled.
 *
 * Takes already-fetched flags; use resolveRequestListEnabled to look them up.
 */
export function isRequestListEnabled(opts: {
  requestListFlag: boolean | undefined;
  teamPlan: string | null | undefined;
}): boolean {
  return (
    teamPlanIsDataroomPlusTier(opts.teamPlan ?? undefined) ||
    Boolean(opts.requestListFlag)
  );
}

export async function resolveRequestListEnabled(opts: {
  teamId: string | null | undefined;
  teamPlan: string | null | undefined;
}): Promise<boolean> {
  // Checked here too, to skip the Edge Config lookup on the common path.
  if (teamPlanIsDataroomPlusTier(opts.teamPlan ?? undefined)) {
    return true;
  }

  const flags = await getFeatureFlags({ teamId: opts.teamId || undefined });
  return isRequestListEnabled({
    requestListFlag: flags.requestList,
    teamPlan: opts.teamPlan,
  });
}
