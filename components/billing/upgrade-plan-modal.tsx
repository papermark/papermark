import Link from "next/link";
import { useRouter } from "next/router";

import { useEffect, useMemo, useState } from "react";
import React from "react";

import { useTeam } from "@/context/team-context";
import { getStripe } from "@/ee/stripe/client";
import { Feature, PlanEnum, getPlanFeatures } from "@/ee/stripe/constants";
import { getPriceIdFromPlan } from "@/ee/stripe/functions/get-price-id-from-plan";
import { PLANS } from "@/ee/stripe/utils";
import { CheckIcon, CircleHelpIcon, Users2Icon, XIcon } from "lucide-react";

import { useAnalytics } from "@/lib/analytics";
import { usePlan } from "@/lib/swr/use-billing";
import { capitalize, cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  BadgeTooltip,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Start Data Room Trial Button Component
const StartDataRoomTrialButton = ({ teamId }: { teamId?: string }) => {
  const router = useRouter();

  const handleStartTrial = () => {
    router.push("/welcome?type=dataroom-trial");
  };

  return (
    <span
      onClick={handleStartTrial}
      className="cursor-pointer underline underline-offset-4 hover:text-foreground"
    >
      Start free data room trial
    </span>
  );
};

// Feature rendering component
const FeatureItem = ({ feature }: { feature: Feature }) => {
  const baseClasses = `flex items-center ${feature.isHighlighted ? "bg-orange-50 -mx-6 px-6 py-2 -my-1 font-bold rounded-md dark:bg-orange-900/20" : ""}`;

  if (feature.isUsers) {
    return (
      <div className={cn("justify-between gap-x-8", baseClasses)}>
        <div className="flex items-center gap-x-3">
          {feature.isNotIncluded ? (
            <XIcon className="h-5 w-5 flex-shrink-0 text-gray-500" />
          ) : (
            <CheckIcon className="h-5 w-5 flex-shrink-0 text-[#fb7a00]" />
          )}
          <span>{feature.text}</span>
        </div>
        {feature.tooltip && (
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <div className="cursor-help">
                  <Users2Icon className="h-4 w-4 text-gray-500" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{feature.tooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    );
  }

  return (
    <div className={cn("text-sm", baseClasses)}>
      {feature.isNotIncluded ? (
        <XIcon className="mr-3 h-5 w-5 flex-shrink-0 text-gray-500" />
      ) : (
        <CheckIcon className="mr-3 h-5 w-5 flex-shrink-0 text-[#fb7a00]" />
      )}
      <div className="flex items-center gap-2">
        <span>{feature.text}</span>
        {feature.tooltip && (
          <BadgeTooltip content={feature.tooltip}>
            <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
          </BadgeTooltip>
        )}
      </div>
    </div>
  );
};

// Segmented control component for Base/Plus/Premium selection
const PlanSelector = ({
  value,
  onChange,
}: {
  value: "base" | "plus" | "premium";
  onChange: (value: "base" | "plus" | "premium") => void;
}) => {
  return (
    <div className="mt-1 flex w-full rounded-lg border border-gray-200 p-1">
      <button
        className={cn(
          "flex-1 rounded-md px-3 py-1 text-sm transition-colors",
          value === "base"
            ? "bg-gray-300 text-foreground dark:bg-gray-600 dark:text-white"
            : "text-gray-600 hover:text-gray-900 dark:text-muted-foreground dark:hover:text-white",
        )}
        onClick={() => onChange("base")}
      >
        Base
      </button>
      <button
        className={cn(
          "flex-1 rounded-md px-3 py-1 text-sm transition-colors",
          value === "plus"
            ? "bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900"
            : "text-gray-600 hover:text-gray-900 dark:text-muted-foreground dark:hover:text-white",
        )}
        onClick={() => onChange("plus")}
      >
        Plus
      </button>
      <button
        className={cn(
          "flex-1 rounded-md px-3 py-1 text-sm transition-colors",
          value === "premium"
            ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
            : "text-gray-600 hover:text-gray-900 dark:text-muted-foreground dark:hover:text-white",
        )}
        onClick={() => onChange("premium")}
      >
        Premium
      </button>
    </div>
  );
};

export function UpgradePlanModal({
  clickedPlan,
  trigger,
  open,
  setOpen,
  highlightItem,
  children,
}: {
  clickedPlan: PlanEnum;
  trigger?: string;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  highlightItem?: string[];
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [period, setPeriod] = useState<"yearly" | "monthly">("yearly");
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { plan: teamPlan, isCustomer, isOldAccount, isTrial } = usePlan();
  const analytics = useAnalytics();
  const [dataRoomsPlanSelection, setDataRoomsPlanSelection] = useState<
    "base" | "plus" | "premium"
  >("base");

  const plansToShow = useMemo(() => {
    switch (clickedPlan) {
      case PlanEnum.Pro:
        return [PlanEnum.Pro, PlanEnum.Business];
      case PlanEnum.Business:
        return [PlanEnum.Business, PlanEnum.DataRooms];
      case PlanEnum.DataRooms:
        return [PlanEnum.DataRooms, PlanEnum.DataRoomsPlus];
      case PlanEnum.DataRoomsPlus:
        return [PlanEnum.DataRoomsPlus, PlanEnum.DataRoomsPremium];
      case PlanEnum.DataRoomsPremium:
        return [PlanEnum.DataRoomsPlus, PlanEnum.DataRoomsPremium];
      default:
        return [PlanEnum.Pro, PlanEnum.Business];
    }
  }, [clickedPlan]);

  // Track analytics event when modal is opened
  useEffect(() => {
    if (open) {
      analytics.capture("Upgrade Button Clicked", {
        trigger: trigger,
        teamId,
      });
    } else {
      setDataRoomsPlanSelection("base");
    }
  }, [open, trigger]);

  const handleUpgradeClick = () => {
    analytics.capture("Upgrade Button Clicked", {
      trigger: trigger,
      teamId,
    });
  };

  // If button is present, clone it and add onClick handler
  const buttonChild = React.isValidElement<{
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
  }>(children)
    ? React.cloneElement(children, { onClick: handleUpgradeClick })
    : children;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{buttonChild}</DialogTrigger>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto bg-gray-50 text-foreground dark:bg-gray-900"
        style={{
          width: "90vw",
          maxWidth: "900px",
        }}
      >
        <div className="flex items-center justify-center">
          <span className="mr-2 text-sm">Monthly</span>
          <Switch
            checked={period === "yearly"}
            onCheckedChange={() =>
              setPeriod(period === "monthly" ? "yearly" : "monthly")
            }
          />
          <span className="ml-2 text-sm">
            Annually <span className="text-[#fb7a00]">(Save up to 35%)</span>
          </span>
        </div>

        <div className="isolate grid grid-cols-1 gap-4 overflow-hidden rounded-xl p-4 md:grid-cols-2">
          {plansToShow.map((planOption) => {
            const isDataRoomsUpgrade = plansToShow.includes(PlanEnum.DataRooms);

            // Determine which plan to show based on selection for Data Rooms
            let effectivePlan = planOption;
            let displayPlanName = planOption;

            if (planOption === PlanEnum.DataRooms && isDataRoomsUpgrade) {
              if (dataRoomsPlanSelection === "plus") {
                effectivePlan = PlanEnum.DataRoomsPlus;
                displayPlanName = PlanEnum.DataRoomsPlus;
              } else if (dataRoomsPlanSelection === "premium") {
                effectivePlan = PlanEnum.DataRoomsPremium;
                displayPlanName = PlanEnum.DataRoomsPremium;
              }
            }

            const planFeatures = getPlanFeatures(effectivePlan, {
              period,
            });

            return (
              <div
                key={displayPlanName}
                className={`relative flex flex-col rounded-lg border ${
                  planOption === PlanEnum.Business
                    ? "border-[#fb7a00]"
                    : planOption === PlanEnum.DataRoomsPlus &&
                        isDataRoomsUpgrade
                      ? "border-gray-900"
                      : "border-gray-200"
                } bg-white p-6 shadow-sm dark:bg-gray-900`}
              >
                <div className="mb-4 border-b border-gray-200 pb-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-balance text-xl font-medium text-gray-900 dark:text-white">
                      {displayPlanName}
                    </h3>
                  </div>
                  <span
                    className={cn(
                      "absolute right-2 top-2 rounded px-2 py-1 text-xs text-white",
                      planOption === PlanEnum.Business && "bg-[#fb7a00]",
                      displayPlanName === PlanEnum.DataRoomsPlus &&
                        "bg-gray-800 dark:bg-gray-200 dark:text-gray-900",
                    )}
                  >
                    {planOption === PlanEnum.Business && "Most popular"}
                    {displayPlanName === PlanEnum.DataRoomsPlus && "Best deal"}
                  </span>
                </div>

                <div className="mb-2">
                  <span className="text-balance text-4xl font-medium tabular-nums text-gray-900 dark:text-white">
                    €
                    {
                      PLANS.find((p) => p.name === displayPlanName)?.price[
                        period
                      ].amount
                    }
                  </span>
                  <span className="text-gray-500 dark:text-white/75">
                    /month{period === "yearly" && ", billed annually"}
                  </span>
                </div>

                {planOption === PlanEnum.DataRooms &&
                  isDataRoomsUpgrade &&
                  !plansToShow.includes(PlanEnum.DataRoomsPlus) && (
                    <PlanSelector
                      value={dataRoomsPlanSelection}
                      onChange={setDataRoomsPlanSelection}
                    />
                  )}

                <p className="mt-4 text-sm text-gray-600 dark:text-white">
                  {planFeatures.featureIntro}
                </p>

                <ul className="mb-6 mt-2 space-y-2 text-sm leading-6 text-gray-600 dark:text-muted-foreground">
                  {planFeatures.features.map((feature, i) => (
                    <li key={i}>
                      <FeatureItem
                        feature={{
                          ...feature,
                          isHighlighted: highlightItem?.includes(feature.id),
                        }}
                      />
                    </li>
                  ))}
                </ul>

                <div className="mt-auto">
                  <Button
                    variant={
                      planOption === PlanEnum.Business ? "default" : "outline"
                    }
                    className={`w-full py-2 text-sm ${
                      planOption === PlanEnum.Business
                        ? "bg-[#fb7a00]/90 text-white hover:bg-[#fb7a00]"
                        : "bg-gray-800 text-white hover:bg-gray-900 hover:text-white dark:hover:bg-gray-700/80"
                    }`}
                    loading={selectedPlan === planOption}
                    disabled={selectedPlan !== null}
                    onClick={() => {
                      const priceId = getPriceIdFromPlan({
                        planName: displayPlanName,
                        period,
                        isOld: isOldAccount,
                      });

                      setSelectedPlan(planOption);
                      if (isCustomer && teamPlan !== "free") {
                        fetch(`/api/teams/${teamId}/billing/manage`, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({
                            priceId,
                            upgradePlan: true,
                          }),
                        })
                          .then(async (res) => {
                            const url = await res.json();
                            router.push(url);
                          })
                          .catch((err) => {
                            alert(err);
                            setSelectedPlan(null);
                          });
                      } else {
                        fetch(
                          `/api/teams/${teamId}/billing/upgrade?priceId=${
                            priceId
                          }`,
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                          },
                        )
                          .then(async (res) => {
                            const data = await res.json();
                            const { id: sessionId } = data;
                            const stripe = await getStripe(isOldAccount);
                            stripe?.redirectToCheckout({ sessionId });
                          })
                          .catch((err) => {
                            alert(err);
                            setSelectedPlan(null);
                          });
                      }
                    }}
                  >
                    {selectedPlan === planOption
                      ? "Redirecting to Stripe..."
                      : `Upgrade to ${displayPlanName} ${capitalize(period)}`}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col items-center text-center text-sm text-muted-foreground">
          All plans include unlimited visitors and page by page document
          analytics.
          <div className="flex items-center gap-2">
            <Link
              href={`/settings/upgrade${
                clickedPlan === PlanEnum.Pro
                  ? "?view=documents"
                  : clickedPlan === PlanEnum.Business
                    ? "?view=business-datarooms"
                    : ""
              }`}
              className="underline underline-offset-4 hover:text-foreground"
            >
              See all plans
            </Link>
            {((teamPlan === "free" && !isTrial) ||
              (teamPlan === "pro" && !isTrial)) && (
              <>
                <span>|</span>
                <StartDataRoomTrialButton teamId={teamId} />
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
