import { PlanEnum } from "@/ee/stripe/constants";

import { useFeatureFlags } from "@/lib/hooks/use-feature-flags";
import { useIsAdmin } from "@/lib/hooks/use-is-admin";
import { usePlan } from "@/lib/swr/use-billing";

import { NavMenu } from "../navigation-menu";

export function SettingsHeader() {
  const { features } = useFeatureFlags();
  const { isAdmin } = useIsAdmin();
  const { isDataroomsPlus, isTrial } = usePlan();

  return (
    <header>
      <section className="mb-4 flex items-center justify-between md:mb-8 lg:mb-12">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            General Settings
          </h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Manage your account settings
          </p>
        </div>
      </section>

      <NavMenu
        navigation={[
          {
            label: "Overview",
            href: `/settings/general`,
            segment: `general`,
          },
          {
            label: "Team",
            href: `/settings/people`,
            segment: "people",
          },
          {
            label: "Domains",
            href: `/settings/domains`,
            segment: "domains",
          },
          {
            label: "Presets",
            href: `/settings/presets`,
            segment: "presets",
          },
          {
            label: "Tags",
            href: `/settings/tags`,
            segment: "tags",
          },
          {
            label: "Agreements",
            href: `/settings/agreements`,
            segment: "agreements",
          },
          {
            label: "Webhooks",
            href: `/settings/webhooks`,
            segment: "webhooks",
          },
          {
            label: "Notifications",
            href: `/settings/notifications`,
            segment: "notifications",
            limited: !isDataroomsPlus && !isTrial,
            clickedPlan: PlanEnum.DataRoomsPlus,
            highlightItem: ["invite"],
          },
          {
            label: "Slack",
            href: `/settings/slack`,
            segment: "slack",
          },
          {
            label: "AI",
            href: `/settings/ai`,
            segment: "ai",
            disabled: !features?.ai,
          },
          {
            label: "Tokens",
            href: `/settings/tokens`,
            segment: "tokens",
            disabled: !features?.tokens,
          },
          {
            label: "API",
            href: `/settings/incoming-webhooks`,
            segment: "incoming-webhooks",
            disabled: !features?.incomingWebhooks,
          },
          {
            label: "Security",
            href: `/settings/security`,
            segment: "security",
            disabled: !isAdmin,
          },
          {
            label: "Billing",
            href: `/settings/billing`,
            segment: "billing",
            disabled: !isAdmin,
          },
        ]}
      />
    </header>
  );
}
