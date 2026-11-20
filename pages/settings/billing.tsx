import { useRouter } from "next/router";

import { useEffect } from "react";

import { useTeam } from "@/context/team-context";
import { sendGTMEvent } from "@next/third-parties/google";
import { toast } from "sonner";

import { useAnalytics } from "@/lib/analytics";
import { usePlan } from "@/lib/swr/use-billing";

import UpgradePlanContainer from "@/components/billing/upgrade-plan-container";
import { GTMComponent } from "@/components/gtm-component";
import AppLayout from "@/components/layouts/app";
import { SettingsHeader } from "@/components/settings/settings-header";

export default function Billing() {
  const router = useRouter();
  const analytics = useAnalytics();

  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { plan } = usePlan();

  useEffect(() => {
    if (router.query.success) {
      toast.success("Upgrade success!");
      analytics.capture("User Upgraded", {
        plan: plan,
        teamId: teamId,
        $set: { teamId: teamId, teamPlan: plan },
      });

      sendGTMEvent({ event: "upgraded" });

      // Remove the success query parameter
      router.replace("/settings/billing", undefined, { shallow: true });
    }

    if (router.query.cancel) {
      analytics.capture("Stripe Checkout Cancelled", {
        teamId: teamId,
      });

      // Remove the cancel query parameter
      router.replace("/settings/billing", undefined, { shallow: true });
    }
  }, [router.query]);

  return (
    <>
      <GTMComponent />
      <AppLayout>
        <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
          <SettingsHeader />

          <UpgradePlanContainer />
        </main>
      </AppLayout>
    </>
  );
}
