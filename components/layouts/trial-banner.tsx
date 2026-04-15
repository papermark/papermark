import { Dispatch, SetStateAction, useEffect, useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import Cookies from "js-cookie";
import { CrownIcon } from "lucide-react";

import { usePlan } from "@/lib/swr/use-billing";
import useDataroomsSimple from "@/lib/swr/use-datarooms-simple";
import { daysLeft } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import {
  Alert,
  AlertClose,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

export default function TrialBanner() {
  const { trial } = usePlan();
  const isTrial = !!trial;
  const [showTrialBanner, setShowTrialBanner] = useState<boolean | null>(null);

  useEffect(() => {
    if (Cookies.get("hideTrialBanner") !== "trial-banner" && isTrial) {
      setShowTrialBanner(true);
    } else {
      setShowTrialBanner(false);
    }
  }, []);

  if (isTrial && showTrialBanner) {
    return <TrialBannerComponent setShowTrialBanner={setShowTrialBanner} />;
  }

  return null;
}

function TrialBannerComponent({
  setShowTrialBanner,
}: {
  setShowTrialBanner: Dispatch<SetStateAction<boolean | null>>;
}) {
  const teamInfo = useTeam();

  const handleHideBanner = () => {
    setShowTrialBanner(false);
    Cookies.set("hideTrialBanner", "trial-banner", {
      expires: 1,
    });
  };

  const { datarooms } = useDataroomsSimple();

  const trialDaysLeft = datarooms
    ? daysLeft(
        new Date(
          datarooms[0]?.createdAt ??
            teamInfo?.currentTeam?.createdAt ??
            new Date(),
        ),
        7,
      )
    : 0;

  const isExpired = trialDaysLeft <= 0;

  return (
    <div className="mx-2 my-2 mb-2 hidden md:block">
      <Alert
        variant="default"
        className={
          isExpired ? "border-2 border-red-500 dark:border-red-600" : ""
        }
      >
        <CrownIcon className="h-4 w-4" />
        <AlertTitle className="pr-6">
          {isExpired
            ? "Your Data Room trial has expired"
            : `Data Room trial: ${trialDaysLeft} days left`}
        </AlertTitle>
        <AlertDescription className="pr-6">
          {isExpired ? (
            <>
              <UpgradePlanModal
                clickedPlan={PlanEnum.DataRooms}
                trigger={"trial_navbar"}
              >
                <span className="cursor-pointer font-bold text-black underline underline-offset-4 hover:text-gray-700 dark:text-white dark:hover:text-gray-300">
                  Upgrade to keep access
                </span>
              </UpgradePlanModal>{" "}
              to unlimited data rooms, custom domains, and granular permissions
            </>
          ) : (
            <>
              You&apos;re on the{" "}
              <span className="font-bold">Data Rooms</span> trial.{" "}
              <UpgradePlanModal
                clickedPlan={PlanEnum.DataRooms}
                trigger={"trial_navbar"}
              >
                <span className="cursor-pointer font-bold text-orange-500 underline underline-offset-4 hover:text-orange-600">
                  Upgrade
                </span>
              </UpgradePlanModal>{" "}
              to keep unlimited data rooms, custom domains, and advanced access
              controls
            </>
          )}
        </AlertDescription>
        <AlertClose onClick={handleHideBanner} />
      </Alert>
    </div>
  );
}
