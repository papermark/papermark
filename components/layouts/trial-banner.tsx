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
  }, [isTrial]);

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
    <div className="mx-2 my-2 mb-2">
      <Alert
        variant="default"
        className={
          isExpired ? "border-2 border-red-500 dark:border-red-600" : ""
        }
      >
        <CrownIcon className="h-4 w-4" />
        <AlertTitle>
          {isExpired
            ? "Your Data Room Plus trial has expired"
            : `Data Room Plus trial: ${trialDaysLeft} days left`}
        </AlertTitle>
        <AlertDescription>
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
              to unlimited data rooms, custom domains, advanced access controls,
              and granular file permissions ✨
            </>
          ) : (
            <>
              You are on the <span className="font-bold">Data Rooms Plus</span>{" "}
              plan trial, you have access to advanced access controls, granular
              file permissions, and data room. <br />
              <UpgradePlanModal
                clickedPlan={PlanEnum.DataRooms}
                trigger={"trial_navbar"}
              >
                <span className="cursor-pointer font-bold text-orange-500 underline underline-offset-4 hover:text-orange-600">
                  Upgrade to keep access
                </span>
              </UpgradePlanModal>
              , unlock unlimited data rooms and custom domains ✨
            </>
          )}
        </AlertDescription>
        <AlertClose onClick={handleHideBanner} />
      </Alert>
    </div>
  );
}
