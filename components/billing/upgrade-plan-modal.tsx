import Link from "next/link";
import { useRouter } from "next/router";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import React from "react";

import { useTeam } from "@/context/team-context";
import { Feature, PlanEnum, getPlanFeatures } from "@/ee/stripe/constants";
import { getPriceIdFromPlan } from "@/ee/stripe/functions/get-price-id-from-plan";
import { PLANS } from "@/ee/stripe/utils";
import { CheckIcon, CircleHelpIcon, UserPlusIcon, XIcon } from "lucide-react";

import { useAnalytics } from "@/lib/analytics";
import { usePlan } from "@/lib/swr/use-billing";
import { useGeoCurrency } from "@/lib/swr/use-geo-currency";
import { useSubscriptionCurrency } from "@/lib/swr/use-subscription-currency";
import { capitalize, cn } from "@/lib/utils";

import {
  type Currency,
  CurrencyToggle,
  PeriodToggle,
  PlanPrice,
} from "@/components/billing/plan-price";
import { UnlimitedPlanModal } from "@/components/billing/unlimited-plan-modal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
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
      Start free Data Rooms Plus trial
    </span>
  );
};

// Feature rendering component
const FeatureItem = ({
  feature,
  onUnlimitedClick,
}: {
  feature: Feature;
  onUnlimitedClick?: () => void;
}) => {
  const baseClasses = `flex items-center ${feature.isHighlighted ? "bg-orange-50 -mx-3 px-3 py-2 -my-1 font-bold rounded-md dark:bg-orange-900/20" : ""}`;

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
                  <UserPlusIcon className="h-4 w-4 text-gray-500" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs">
                <p>{feature.tooltip}</p>
                {onUnlimitedClick && (
                  <p className="mt-1">
                    or{" "}
                    <span
                      className="cursor-pointer underline underline-offset-2"
                      onClick={onUnlimitedClick}
                    >
                      get unlimited
                    </span>
                  </p>
                )}
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
            ? "bg-[#fb7a00] text-white"
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

// Popups whose primary subject is data rooms (opened from the data rooms tab
// or the trial flow). In these contexts the "Unlimited data rooms" line is kept
// on the Plus/Premium cards; elsewhere it's only shown on the base Data Rooms
// card to avoid repeating it.
const DATAROOM_CONTEXT_TRIGGERS = [
  "datarooms",
  "sidebar_datarooms",
  "dataroom_trial_form",
];

export function UpgradePlanModal({
  clickedPlan,
  trigger,
  open,
  setOpen,
  highlightItem,
  hideItems,
  children,
}: {
  clickedPlan: PlanEnum;
  trigger?: string;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  highlightItem?: string[];
  /** Feature ids (or `aliasIds`) to omit from every plan card's feature list.
   *  Use this when the upsell is about a specific feature and a generic line
   *  (e.g. "Unlimited data rooms") would distract from the message. */
  hideItems?: string[];
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [period, setPeriod] = useState<"yearly" | "monthly">("yearly");
  const geoCurrency = useGeoCurrency();
  const { currency: subscriptionCurrency } = useSubscriptionCurrency();
  const [currencyOverride, setCurrencyOverride] = useState<Currency | null>(
    null,
  );
  // Existing customers are locked to the currency they already pay in (Stripe
  // subscriptions cannot mix currencies). Otherwise default to the visitor's
  // geo currency, with a manual toggle taking precedence.
  const currency: Currency =
    subscriptionCurrency ?? currencyOverride ?? geoCurrency ?? "usd";
  const isCurrencyLocked = subscriptionCurrency != null;
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { plan: teamPlan, isCustomer, isOldAccount, isTrial } = usePlan();
  const analytics = useAnalytics();
  const [dataRoomsPlanSelection, setDataRoomsPlanSelection] = useState<
    "base" | "plus" | "premium"
  >("base");
  const [unlimitedModalOpen, setUnlimitedModalOpen] = useState(false);

  // Only show the "pinned" styling (sticky button border/shadow, footer divider)
  // when the cards actually overflow. When everything fits, it reads as one panel.
  const [isScrollable, setIsScrollable] = useState(false);
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const measureScrollable = useCallback(() => {
    const el = scrollElRef.current;
    if (el) {
      setIsScrollable(el.scrollHeight > el.clientHeight + 1);
    }
  }, []);

  const scrollRefCallback = useCallback(
    (node: HTMLDivElement | null) => {
      resizeObserverRef.current?.disconnect();
      scrollElRef.current = node;
      if (node) {
        const observer = new ResizeObserver(() => measureScrollable());
        observer.observe(node);
        for (const child of Array.from(node.children)) {
          observer.observe(child);
        }
        resizeObserverRef.current = observer;
        measureScrollable();
      }
    },
    [measureScrollable],
  );

  // Re-measure when content that affects height changes.
  useEffect(() => {
    measureScrollable();
  }, [open, period, dataRoomsPlanSelection, measureScrollable]);

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
      case PlanEnum.DataRoomsUnlimited:
        return [PlanEnum.DataRoomsPremium, PlanEnum.DataRoomsUnlimited];
      default:
        return [PlanEnum.Pro, PlanEnum.Business];
    }
  }, [clickedPlan]);

  // When the popup is about data rooms (data rooms tab / trial), keep the
  // "Unlimited data rooms" line on the Plus & Premium cards too.
  const isDataRoomContextPopup = DATAROOM_CONTEXT_TRIGGERS.includes(
    trigger ?? "",
  );
  // Views that only render the Plus/Premium tiers have no base Data Rooms card,
  // so the line must stay visible there.
  const onlyPlusAndPremiumShown =
    !plansToShow.includes(PlanEnum.Pro) &&
    !plansToShow.includes(PlanEnum.Business) &&
    !plansToShow.includes(PlanEnum.DataRooms);
  // Feature-specific upsells (e.g. API, SSO) highlight a particular feature.
  // There the generic "Unlimited data rooms" line shouldn't be repeated on
  // every plan card.
  const hasSpecificFeatureHighlight = !!highlightItem?.some(
    (item) => item !== "datarooms",
  );

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
        mobileFullScreen
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="max-h-[90vh] overflow-hidden bg-gray-50 p-0 text-foreground dark:bg-gray-900"
        style={{
          width: "90vw",
          maxWidth: "900px",
        }}
      >
        <div className="flex max-h-[90vh] flex-col max-sm:h-full max-sm:max-h-none">
          {/* Fixed header — billing period toggle stays visible while the cards scroll */}
          <div className="flex-none bg-gray-50 px-4 pb-5 pt-10 dark:bg-gray-900 sm:px-6 sm:pb-5 sm:pt-6">
            <div className="relative flex flex-col items-center gap-3 sm:block">
              {!isCurrencyLocked && (
                <div className="sm:absolute sm:left-0 sm:top-1/2 sm:-translate-y-1/2">
                  <CurrencyToggle
                    value={currency}
                    onChange={setCurrencyOverride}
                  />
                </div>
              )}
              <div className="flex items-center justify-center gap-2">
                <PeriodToggle value={period} onChange={setPeriod} />
                <span className="text-sm text-[#fb7a00]">
                  (Save up to 35%)
                </span>
              </div>
            </div>
          </div>

          {/* Scrollable middle — only the plan cards scroll */}
          <div
            ref={scrollRefCallback}
            className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6"
          >
            {trigger === "invite_team_members" &&
              [
                PlanEnum.DataRooms,
                PlanEnum.DataRoomsPlus,
                PlanEnum.DataRoomsPremium,
              ].includes(clickedPlan) && (
                <p
                  className="cursor-pointer pb-4 text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setUnlimitedModalOpen(true)}
                >
                  Interested in unlimited seats?{" "}
                  <span className="font-light underline underline-offset-4">
                    Get unlimited
                  </span>
                </p>
              )}

            {[
              PlanEnum.DataRooms,
              PlanEnum.DataRoomsPlus,
              PlanEnum.DataRoomsPremium,
            ].includes(clickedPlan) &&
              trigger !== "invite_team_members" && (
                <p
                  className="cursor-pointer pb-4 text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setUnlimitedModalOpen(true)}
                >
                  Deals with everything unlimited?{" "}
                  <span className="font-light underline underline-offset-4">
                    Get unlimited members, storage, and data rooms in one plan.
                  </span>
                </p>
              )}

            <div className="isolate grid grid-cols-1 gap-4 rounded-xl md:grid-cols-[19fr_21fr]">
              {plansToShow.map((planOption) => {
                const isDataRoomsUpgrade = plansToShow.includes(
                  PlanEnum.DataRooms,
                );
                // Determine which plan to show based on selection for Data Rooms
                let effectivePlan = planOption;
                let displayPlanName = planOption;

                const isDataRoomsPlusUpgrade =
                  plansToShow.includes(PlanEnum.DataRooms) &&
                  plansToShow.includes(PlanEnum.DataRoomsPlus);

                if (
                  planOption === PlanEnum.DataRooms &&
                  isDataRoomsUpgrade &&
                  !isDataRoomsPlusUpgrade
                ) {
                  if (dataRoomsPlanSelection === "plus") {
                    effectivePlan = PlanEnum.DataRoomsPlus;
                    displayPlanName = PlanEnum.DataRoomsPlus;
                  } else if (dataRoomsPlanSelection === "premium") {
                    effectivePlan = PlanEnum.DataRoomsPremium;
                    displayPlanName = PlanEnum.DataRoomsPremium;
                  }
                }

                if (
                  planOption === PlanEnum.DataRoomsPlus &&
                  isDataRoomsPlusUpgrade
                ) {
                  if (dataRoomsPlanSelection === "premium") {
                    effectivePlan = PlanEnum.DataRoomsPremium;
                    displayPlanName = PlanEnum.DataRoomsPremium;
                  }
                }

                const highlightForSelector = (() => {
                  if (
                    plansToShow[0] === PlanEnum.Business &&
                    plansToShow[1] === PlanEnum.DataRooms &&
                    planOption === PlanEnum.DataRooms
                  ) {
                    if (trigger === "sidebar_datarooms") {
                      if (displayPlanName === PlanEnum.DataRoomsPlus)
                        return ["documents"];
                      if (displayPlanName === PlanEnum.DataRoomsPremium)
                        return ["storage", "file-size"];
                    }
                    if (trigger === "invite_team_members") {
                      if (displayPlanName === PlanEnum.DataRoomsPremium)
                        return ["teams", "users"];
                    }
                  }
                  return [];
                })();

                const planFeatures = getPlanFeatures(effectivePlan, {
                  period,
                  currency,
                  highlightFeatures: highlightForSelector,
                });

                const isBusinessDataRoomsView =
                  plansToShow[0] === PlanEnum.Business &&
                  plansToShow[1] === PlanEnum.DataRooms;

                const isDataRoomsDataRoomsPlusView =
                  plansToShow[0] === PlanEnum.DataRooms &&
                  plansToShow[1] === PlanEnum.DataRoomsPlus;

                const isRightColumn =
                  planOption === plansToShow[1] ||
                  (isBusinessDataRoomsView &&
                    planOption === PlanEnum.DataRooms);

                const getBorderClass = () => {
                  if (isBusinessDataRoomsView) {
                    if (planOption === PlanEnum.Business)
                      return "border-gray-200 dark:border-gray-700";
                    if (planOption === PlanEnum.DataRooms) {
                      if (displayPlanName === PlanEnum.DataRooms)
                        return "border-[#fb7a00]";
                      return "border-gray-900 dark:border-white";
                    }
                  }
                  if (isDataRoomsDataRoomsPlusView) {
                    if (planOption === PlanEnum.DataRooms)
                      return "border-[#fb7a00]";
                    if (planOption === PlanEnum.DataRoomsPlus) {
                      if (displayPlanName === PlanEnum.DataRoomsPremium)
                        return "border-gray-900 dark:border-white";
                      return "border-gray-200 dark:border-gray-700";
                    }
                  }
                  if (isRightColumn) return "border-gray-900 dark:border-white";
                  return "border-gray-200 dark:border-gray-700";
                };

                const getBadge = () => {
                  if (isBusinessDataRoomsView) {
                    if (
                      planOption === PlanEnum.DataRooms &&
                      displayPlanName === PlanEnum.DataRooms
                    )
                      return {
                        text: "Most popular",
                        className: "bg-[#fb7a00]",
                      };
                    if (
                      planOption === PlanEnum.DataRooms &&
                      displayPlanName === PlanEnum.DataRoomsPremium
                    )
                      return {
                        text: "Best offer",
                        className:
                          "bg-gray-900 dark:bg-white dark:text-gray-900",
                      };
                    return null;
                  }
                  if (isDataRoomsDataRoomsPlusView) {
                    if (planOption === PlanEnum.DataRooms)
                      return {
                        text: "Most popular",
                        className: "bg-[#fb7a00]",
                      };
                    if (
                      planOption === PlanEnum.DataRoomsPlus &&
                      displayPlanName === PlanEnum.DataRoomsPremium
                    )
                      return {
                        text: "Best offer",
                        className:
                          "bg-gray-900 dark:bg-white dark:text-gray-900",
                      };
                    return null;
                  }
                  if (
                    isRightColumn &&
                    displayPlanName === PlanEnum.DataRoomsPremium
                  )
                    return {
                      text: "Best offer",
                      className: "bg-gray-900 dark:bg-white dark:text-gray-900",
                    };
                  if (planOption === PlanEnum.Business)
                    return { text: "Popular", className: "bg-[#fb7a00]" };
                  return null;
                };

                const badge = getBadge();

                return (
                  <div
                    key={displayPlanName}
                    className={cn(
                      "relative flex flex-col rounded-lg border bg-white p-6 shadow-sm dark:bg-gray-900",
                      getBorderClass(),
                    )}
                  >
                    <div className="mb-4 border-b border-gray-200 pb-2 dark:border-gray-700">
                      <div className="flex items-center justify-between">
                        <h3 className="text-balance text-xl font-medium text-gray-900 dark:text-white">
                          {displayPlanName}
                        </h3>
                      </div>
                      {badge && (
                        <span
                          className={cn(
                            "absolute right-2 top-2 rounded px-2 py-1 text-xs text-white",
                            badge.className,
                          )}
                        >
                          {badge.text}
                        </span>
                      )}
                    </div>

                    <PlanPrice
                      amount={
                        PLANS.find((p) => p.name === displayPlanName)?.price[
                          period
                        ].amount ?? 0
                      }
                      amountUsd={
                        PLANS.find((p) => p.name === displayPlanName)?.price[
                          period
                        ].amountUsd
                      }
                      period={period}
                      currency={currency}
                    />

                    {planOption === PlanEnum.DataRooms &&
                      isDataRoomsUpgrade &&
                      !plansToShow.includes(PlanEnum.DataRoomsPlus) && (
                        <PlanSelector
                          value={dataRoomsPlanSelection}
                          onChange={setDataRoomsPlanSelection}
                        />
                      )}
                    {planOption === PlanEnum.DataRoomsPlus &&
                      isDataRoomsPlusUpgrade && (
                        <div className="mt-1 flex w-full rounded-lg border border-gray-200 p-1">
                          <button
                            className={cn(
                              "flex-1 rounded-md px-3 py-1 text-sm transition-colors",
                              dataRoomsPlanSelection !== "premium"
                                ? "bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900"
                                : "text-gray-600 hover:text-gray-900 dark:text-muted-foreground dark:hover:text-white",
                            )}
                            onClick={() => setDataRoomsPlanSelection("plus")}
                          >
                            Plus
                          </button>
                          <button
                            className={cn(
                              "flex-1 rounded-md px-3 py-1 text-sm transition-colors",
                              dataRoomsPlanSelection === "premium"
                                ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                                : "text-gray-600 hover:text-gray-900 dark:text-muted-foreground dark:hover:text-white",
                            )}
                            onClick={() => setDataRoomsPlanSelection("premium")}
                          >
                            Premium
                          </button>
                        </div>
                      )}

                    <p className="mt-4 text-sm text-gray-600 dark:text-white">
                      {planFeatures.featureIntro}
                    </p>

                    <ul className="mb-2 mt-2 space-y-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                      {planFeatures.features
                        .filter((feature) => {
                          // Hide the generic "Unlimited data rooms" line on the
                          // higher data room tiers (Plus/Premium/Unlimited) — the
                          // base Data Rooms card already communicates it. Keep it
                          // for data-room popups (data rooms tab / trial) and for
                          // generic Plus/Premium-only comparisons, but not for
                          // feature-specific upsells (e.g. API, SSO).
                          const isHigherDataRoomTier =
                            effectivePlan === PlanEnum.DataRoomsPlus ||
                            effectivePlan === PlanEnum.DataRoomsPremium ||
                            effectivePlan === PlanEnum.DataRoomsUnlimited;
                          const showUnlimitedDataRoomsLine =
                            isDataRoomContextPopup ||
                            (onlyPlusAndPremiumShown &&
                              !hasSpecificFeatureHighlight);
                          if (
                            feature.id === "datarooms" &&
                            isHigherDataRoomTier &&
                            !showUnlimitedDataRoomsLine
                          ) {
                            return false;
                          }
                          // "Assign team members" is only shown (and highlighted)
                          // when the upsell originates from the assign-team-members
                          // flow; otherwise keep it off every plan card.
                          if (
                            feature.id === "assign" &&
                            !(
                              highlightItem?.includes("assign") ||
                              feature.aliasIds?.some((alias) =>
                                highlightItem?.includes(alias),
                              )
                            )
                          ) {
                            return false;
                          }
                          if (!hideItems?.length) return true;
                          if (hideItems.includes(feature.id)) return false;
                          if (
                            feature.aliasIds?.some((alias) =>
                              hideItems.includes(alias),
                            )
                          ) {
                            return false;
                          }
                          return true;
                        })
                        .map((feature, i) => {
                          const isDataRoomPlan =
                            effectivePlan === PlanEnum.DataRooms ||
                            effectivePlan === PlanEnum.DataRoomsPlus ||
                            effectivePlan === PlanEnum.DataRoomsPremium;
                          return (
                            <li key={i}>
                              <FeatureItem
                                feature={{
                                  ...feature,
                                  isHighlighted:
                                    feature.isHighlighted ||
                                    highlightItem?.includes(feature.id) ||
                                    feature.aliasIds?.some((alias) =>
                                      highlightItem?.includes(alias),
                                    ),
                                }}
                                onUnlimitedClick={
                                  feature.isUsers && isDataRoomPlan
                                    ? () => setUnlimitedModalOpen(true)
                                    : undefined
                                }
                              />
                            </li>
                          );
                        })}
                    </ul>

                    <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-auto rounded-b-lg bg-white px-6 pb-6 pt-2 dark:bg-gray-900">
                      <Button
                        variant={
                          planOption === PlanEnum.Business &&
                          !isBusinessDataRoomsView
                            ? "default"
                            : "outline"
                        }
                        className={cn(
                          "w-full py-2 text-sm",
                          (() => {
                            if (
                              isBusinessDataRoomsView &&
                              planOption === PlanEnum.DataRooms &&
                              displayPlanName === PlanEnum.DataRooms
                            )
                              return "bg-[#fb7a00]/90 text-white hover:bg-[#fb7a00] hover:text-white";
                            if (
                              isDataRoomsDataRoomsPlusView &&
                              planOption === PlanEnum.DataRooms
                            )
                              return "bg-[#fb7a00]/90 text-white hover:bg-[#fb7a00] hover:text-white";
                            if (
                              planOption === PlanEnum.Business &&
                              !isBusinessDataRoomsView
                            )
                              return "bg-[#fb7a00]/90 text-white hover:bg-[#fb7a00] hover:text-white";
                            return "bg-gray-800 text-white hover:bg-gray-900 hover:text-white dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200";
                          })(),
                        )}
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
                              }&currency=${currency}`,
                              {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                              },
                            )
                              .then(async (res) => {
                                const data = await res.json();
                                if (data.url) {
                                  window.location.href = data.url;
                                }
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
          </div>
          {/* Fixed footer — actions and trial stay visible without scrolling */}
          <div
            className={cn(
              "flex-none bg-gray-50 px-4 pb-5 pt-4 text-center text-sm text-muted-foreground dark:bg-gray-900 sm:px-6",
              isScrollable && "border-t border-gray-200 dark:border-gray-800",
            )}
          >
            All plans include{" "}
            <span className="font-medium text-foreground">
              unlimited visitors
            </span>{" "}
            and page by page document analytics.{" "}
            <Link
              href={`/settings/billing/upgrade${
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
                {" | "}
                <StartDataRoomTrialButton teamId={teamId} />
              </>
            )}
          </div>

          <UnlimitedPlanModal
            period={period}
            currency={currency}
            open={unlimitedModalOpen}
            setOpen={setUnlimitedModalOpen}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
