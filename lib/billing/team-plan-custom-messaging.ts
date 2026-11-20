/**
 * Custom welcome message + CTA (team & dataroom branding) require Business or
 * Data Rooms plans. Trial teams that include drtrial may use these features.
 */
export function teamPlanAllowsCustomWelcomeAndCta(
  plan: string | null | undefined,
): boolean {
  if (!plan || plan === "free") return false;
  if (plan.includes("drtrial")) return true;
  const base = plan.split("+")[0];
  return (
    base === "business" ||
    base === "datarooms" ||
    base === "datarooms-plus" ||
    base === "datarooms-premium" ||
    base === "datarooms-unlimited"
  );
}

/** Matches client `usePlan().isDataroomsPlus` (base segment before +drtrial / +old / etc.). */
export function teamPlanIsDataroomPlusTier(
  plan: string | null | undefined,
): boolean {
  if (!plan || plan === "free") return false;
  const base = plan.split("+")[0];
  return (
    base === "datarooms-plus" ||
    base === "datarooms-premium" ||
    base === "datarooms-unlimited"
  );
}

/**
 * Saving custom dataroom *layout* settings (preset, folder tree, card layout,
 * header style, …) is gated to the Data Rooms tier or active dataroom trials.
 *
 * Visibility (whether the Layouts UI even renders) is a looser check —
 * Business plans see and configure the controls, but the Save action triggers
 * the upgrade modal until the team is on a Data Rooms plan.
 */
export function teamPlanAllowsLayoutCustomization(
  plan: string | null | undefined,
): boolean {
  if (!plan || plan === "free") return false;
  if (plan.includes("drtrial")) return true;
  const base = plan.split("+")[0];
  return (
    base === "datarooms" ||
    base === "datarooms-plus" ||
    base === "datarooms-premium" ||
    base === "datarooms-unlimited"
  );
}

/**
 * Visitor language picker (dataroom branding → Language) is gated to the
 * Data Rooms Plus tier and above (or any active dataroom trial). English is
 * the always-free default and is enforced separately at the call site.
 */
export function teamPlanAllowsVisitorLanguage(
  plan: string | null | undefined,
): boolean {
  if (!plan || plan === "free") return false;
  if (plan.includes("drtrial")) return true;
  const base = plan.split("+")[0];
  return (
    base === "datarooms-plus" ||
    base === "datarooms-premium" ||
    base === "datarooms-unlimited"
  );
}

/**
 * Whether the Layouts UI should be rendered at all in the global branding /
 * dataroom branding screens. Free plans have no exposure to it; Business and
 * higher (or any dataroom trial) can see and tweak the controls.
 */
export function teamPlanShowsLayoutUi(
  plan: string | null | undefined,
): boolean {
  if (!plan || plan === "free") return false;
  if (plan.includes("drtrial")) return true;
  const base = plan.split("+")[0];
  return (
    base === "business" ||
    base === "datarooms" ||
    base === "datarooms-plus" ||
    base === "datarooms-premium" ||
    base === "datarooms-unlimited"
  );
}
