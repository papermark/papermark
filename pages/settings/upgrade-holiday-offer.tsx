import { useRouter } from "next/router";

import { useEffect, useState } from "react";
import React from "react";

import { useTeam } from "@/context/team-context";
import { getStripe } from "@/ee/stripe/client";
import { Feature, PlanEnum, getPlanFeatures } from "@/ee/stripe/constants";
import { PLANS } from "@/ee/stripe/utils";
import { CheckIcon, Users2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { useAnalytics } from "@/lib/analytics";
import { usePlan } from "@/lib/swr/use-billing";
import { capitalize } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Calculate 30% discounted yearly price
const getDiscountedYearlyPrice = (yearlyPrice: number) => {
  return Math.round(yearlyPrice * 0.7); // Round to whole number
};

// Calculate savings: monthly*12 vs yearly*12*0.7
const calculateSavings = (monthlyPrice: number, yearlyPrice: number) => {
  const monthlyForYear = monthlyPrice * 12;
  const yearlyWithDiscount = Math.round(yearlyPrice * 12 * 0.7);
  return monthlyForYear - yearlyWithDiscount;
};

// Feature rendering component
const FeatureItem = ({
  feature,
  period,
}: {
  feature: Feature;
  period: "monthly" | "yearly";
}) => {
  const baseClasses = `flex items-center ${feature.isHighlighted ? "bg-orange-50 -mx-6 px-6 py-2 rounded-md dark:bg-orange-900/20" : ""}`;

  if (feature.isUsers) {
    return (
      <div className={`justify-between gap-x-8 ${baseClasses}`}>
        <div className="flex items-center gap-x-3">
          {feature.isNotIncluded ? (
            <XIcon className="h-6 w-5 flex-none text-gray-500" />
          ) : (
            <CheckIcon className="h-6 w-5 flex-none text-[#fb7a00]" />
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

  if (feature.isCustomDomain) {
    return (
      <span className={`gap-x-3 ${baseClasses}`}>
        {feature.isNotIncluded ? (
          <XIcon className="h-6 w-5 flex-none text-gray-500" />
        ) : (
          <CheckIcon className="h-6 w-5 flex-none text-[#fb7a00]" />
        )}
        <span>{feature.text}</span>
      </span>
    );
  }

  return (
    <div className={`gap-x-3 ${baseClasses}`}>
      {feature.isNotIncluded ? (
        <XIcon className="h-6 w-5 flex-none text-gray-500" />
      ) : (
        <CheckIcon className="h-6 w-5 flex-none text-[#fb7a00]" />
      )}
      <span>{feature.text}</span>
    </div>
  );
};

// Toggle component for Document Sharing vs Data Rooms
const PlanTypeSelector = ({
  value,
  onChange,
}: {
  value: "documents" | "datarooms" | "business-datarooms";
  onChange: (value: "documents" | "datarooms") => void;
}) => {
  const isDocuments = value === "documents";
  const isDatarooms = value === "datarooms";

  return (
    <div className="mb-8 flex w-full max-w-md items-center justify-center rounded-lg border border-gray-200 p-1">
      <button
        className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
          isDocuments
            ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
            : "text-gray-600 hover:text-gray-900 dark:text-muted-foreground dark:hover:text-white"
        }`}
        onClick={() => onChange("documents")}
      >
        Document Sharing
      </button>
      <button
        className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
          isDatarooms
            ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
            : "text-gray-600 hover:text-gray-900 dark:text-muted-foreground dark:hover:text-white"
        }`}
        onClick={() => onChange("datarooms")}
      >
        Data Rooms
      </button>
    </div>
  );
};

export default function UpgradeHolidayOfferPage() {
  const router = useRouter();
  const [period, setPeriod] = useState<"yearly" | "monthly">("yearly");
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const teamInfo = useTeam();
  const { plan: teamPlan, trial, isCustomer, isOldAccount } = usePlan();
  const analytics = useAnalytics();

  // Determine initial view based on query params or default to datarooms
  const getInitialView = () => {
    if (router.query.view === "documents") return "documents";
    if (router.query.view === "business-datarooms") return "business-datarooms";
    return "datarooms";
  };
  const [planType, setPlanType] = useState<
    "documents" | "datarooms" | "business-datarooms"
  >(getInitialView());

  // Update planType when query param changes
  useEffect(() => {
    if (router.query.view === "documents") {
      setPlanType("documents");
    } else if (router.query.view === "business-datarooms") {
      setPlanType("business-datarooms");
    } else if (router.query.view === "datarooms" || !router.query.view) {
      setPlanType("datarooms");
    }
  }, [router.query.view]);

  // Document sharing plans (first 3)
  const documentSharingPlans = [
    PlanEnum.Pro,
    PlanEnum.Business,
    PlanEnum.DataRooms,
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-8 dark:bg-gray-900">
      <h1 className="mb-8 text-center text-3xl font-bold">
        Select best plan for your business.
      </h1>
      <p className="mb-8 text-center text-sm text-gray-500 dark:text-gray-400">
        Additional 30% off on annual plans. New Year&apos;s offer. Ends Jan 15 2026
      </p>

      <div className="mb-8 flex items-center justify-center">
        <span className="mr-2 text-sm">
          Monthly{" "}
          {period === "monthly" && <span className="text-[#fb7a00]"></span>}
        </span>
        <Switch
          checked={period === "yearly"}
          onCheckedChange={() =>
            setPeriod(period === "monthly" ? "yearly" : "monthly")
          }
        />
        <span className="ml-2 text-sm">
          Annually <span className="text-[#fb7a00]">(Save 50%)</span>
        </span>
      </div>

      {/* Plan Type Selector */}
      <div className="mb-8 flex justify-center">
        <PlanTypeSelector
          value={planType}
          onChange={(value) => setPlanType(value)}
        />
      </div>

      {/* Document Sharing Plans (3 in a row) */}
      {planType === "documents" && (
        <div className="mb-8 grid grid-cols-1 gap-2 md:grid-cols-3">
          {documentSharingPlans.map((planOption) => {
            const planFeatures = getPlanFeatures(planOption, { period });
            const planData = PLANS.find((p) => p.name === planOption);
            if (!planData) return null;

            const monthlyPrice = planData.price.monthly.amount;
            const yearlyPrice = planData.price.yearly.amount;
            const discountedYearlyPrice =
              period === "yearly"
                ? getDiscountedYearlyPrice(yearlyPrice)
                : yearlyPrice;
            const savings =
              period === "yearly"
                ? calculateSavings(monthlyPrice, yearlyPrice)
                : 0;

            return (
              <div
                key={planOption}
                className={`relative flex flex-col rounded-lg border ${
                  planOption === PlanEnum.Business ||
                  planOption === PlanEnum.DataRoomsPlus
                    ? "border-[#fb7a00]"
                    : planOption === PlanEnum.DataRoomsPremium
                      ? "border-gray-900 dark:border-gray-200"
                      : "border-gray-400"
                } bg-white p-6 shadow-sm dark:bg-gray-900`}
              >
                <div className="mb-4 border-b border-gray-200 pb-2">
                  <h3 className="text-balance text-xl font-medium text-foreground text-gray-900 dark:text-white">
                    {planOption}
                  </h3>
                  {period === "yearly" && savings > 0 && (
                    <span className="absolute right-2 top-2 rounded bg-[#fb7a00]/10 px-2 py-1 text-xs font-medium text-[#fb7a00]">
                      Save €{savings}/year
                    </span>
                  )}
                  {period === "monthly" &&
                    (planOption === PlanEnum.Business ||
                      planOption === PlanEnum.DataRoomsPlus) && (
                      <span
                        className={`absolute -top-3 right-4 rounded px-2 py-1 text-xs text-white ${
                          planOption === PlanEnum.DataRoomsPlus
                            ? "bg-gray-800 dark:bg-gray-200 dark:text-black"
                            : "bg-[#fb7a00]"
                        }`}
                      >
                        {planOption === PlanEnum.DataRoomsPlus
                          ? "Best offer"
                          : "Most popular"}
                      </span>
                    )}
                </div>

                <div className="mb-2 text-balance text-4xl font-medium tabular-nums text-foreground">
                  €{period === "yearly" ? discountedYearlyPrice : monthlyPrice}
                  <span className="text-base font-normal dark:text-white/75">
                    /month{period === "yearly" && ", billed annually"}
                  </span>
                </div>
                {period === "yearly" && (
                  <>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-sm text-gray-500 line-through">
                        €{yearlyPrice}/month
                      </span>
                      <span className="rounded bg-[#fb7a00]/10 px-2 py-0.5 text-xs font-medium text-[#fb7a00]">
                        30% OFF
                      </span>
                    </div>
                  </>
                )}
                <p className="mt-4 text-sm text-gray-600 dark:text-white">
                  {planFeatures.featureIntro}
                </p>

                <ul
                  role="list"
                  className="mb-4 mt-4 space-y-3 text-sm leading-6 text-gray-600"
                >
                  {planFeatures.features.map((feature, i) => (
                    <li key={i}>
                      <FeatureItem feature={feature} period={period} />
                    </li>
                  ))}
                </ul>
                <div className="mt-auto">
                  <Button
                    variant={
                      planOption === PlanEnum.Business ? "default" : "default"
                    }
                    className={`w-full py-2 text-sm ${
                      planOption === PlanEnum.Business
                        ? "bg-[#fb7a00]/90 text-white hover:bg-[#fb7a00]"
                        : planOption === PlanEnum.DataRoomsPremium
                          ? "bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                          : "bg-gray-800 text-white hover:bg-gray-900 dark:hover:bg-gray-700/80"
                    }`}
                    loading={selectedPlan === planOption}
                    disabled={selectedPlan !== null}
                    onClick={() => {
                      setSelectedPlan(planOption);
                      const envKey =
                        process.env.NEXT_PUBLIC_VERCEL_ENV === "production"
                          ? "production"
                          : "test";
                      const plan = PLANS.find((p) => p.name === planOption);
                      if (!plan) return;
                      const priceId =
                        plan.price[period].priceIds[envKey][
                          isOldAccount ? "old" : "new"
                        ];

                      if (isCustomer && teamPlan !== "free") {
                        fetch(
                          `/api/teams/${teamInfo?.currentTeam?.id}/billing/manage`,
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                              priceId,
                              upgradePlan: true,
                              applyYearlyDiscount: period === "yearly",
                            }),
                          },
                        )
                          .then(async (res) => {
                            if (res.status === 429) {
                              toast.error(
                                "Rate limit exceeded. Please try again later.",
                              );
                              setSelectedPlan(null);
                              return;
                            }

                            const url = await res.json();
                            router.push(url);
                          })
                          .catch((err) => {
                            alert(err);
                            setSelectedPlan(null);
                          });
                      } else {
                        fetch(
                          `/api/teams/${
                            teamInfo?.currentTeam?.id
                          }/billing/upgrade?priceId=${priceId}&applyYearlyDiscount=${period === "yearly"}`,
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                          },
                        )
                          .then(async (res) => {
                            if (res.status === 429) {
                              toast.error(
                                "Rate limit exceeded. Please try again later.",
                              );
                              setSelectedPlan(null);
                              return;
                            }

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
                      : `Upgrade to ${planOption} ${capitalize(period)}`}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Business + Data Rooms Plans (4 in a row) */}
      {planType === "business-datarooms" && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          {[
            PlanEnum.Business,
            PlanEnum.DataRooms,
            PlanEnum.DataRoomsPlus,
            PlanEnum.DataRoomsPremium,
          ].map((planOption) => {
            const planFeatures = getPlanFeatures(planOption, { period });
            const planData = PLANS.find((p) => p.name === planOption);
            if (!planData) return null;

            const monthlyPrice = planData.price.monthly.amount;
            const yearlyPrice = planData.price.yearly.amount;
            const discountedYearlyPrice =
              period === "yearly"
                ? getDiscountedYearlyPrice(yearlyPrice)
                : yearlyPrice;
            const savings =
              period === "yearly"
                ? calculateSavings(monthlyPrice, yearlyPrice)
                : 0;

            return (
              <div
                key={planOption}
                className={`relative flex flex-col rounded-lg border ${
                  planOption === PlanEnum.Business
                    ? "border-[#fb7a00]"
                    : planOption === PlanEnum.DataRoomsPremium
                      ? "border-gray-900 dark:border-gray-200"
                      : planOption === PlanEnum.DataRoomsPlus
                        ? "border-gray-800 dark:border-gray-300"
                        : "border-gray-400"
                } bg-white p-6 shadow-sm dark:bg-gray-900`}
              >
                <div className="mb-4 border-b border-gray-200 pb-2">
                  <h3 className="text-balance text-xl font-medium text-foreground text-gray-900 dark:text-white">
                    {planOption}
                  </h3>
                  {period === "monthly" &&
                    (planOption === PlanEnum.Business ||
                      planOption === PlanEnum.DataRoomsPlus) && (
                      <span className="absolute -top-3 right-4 rounded bg-[#fb7a00] px-2 py-1 text-xs text-white">
                        {planOption === PlanEnum.Business
                          ? "Most popular"
                          : "Best offer"}
                      </span>
                    )}
                  {period === "yearly" && savings > 0 && (
                    <span className="absolute right-2 top-2 rounded bg-[#fb7a00]/10 px-2 py-1 text-xs font-medium text-[#fb7a00]">
                      Save €{savings}/year
                    </span>
                  )}
                </div>

                <div className="mb-2 text-balance text-4xl font-medium tabular-nums text-foreground">
                  €{period === "yearly" ? discountedYearlyPrice : monthlyPrice}
                  <span className="text-base font-normal dark:text-white/75">
                    /month{period === "yearly" && ", billed annually"}
                  </span>
                </div>
                {period === "yearly" && (
                  <>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-sm text-gray-500 line-through">
                        €{yearlyPrice}/month
                      </span>
                      <span className="rounded bg-[#fb7a00]/10 px-2 py-0.5 text-xs font-medium text-[#fb7a00]">
                        30% OFF
                      </span>
                    </div>
                  </>
                )}
                <p className="mt-4 text-sm text-gray-600 dark:text-white">
                  {planFeatures.featureIntro}
                </p>

                <ul
                  role="list"
                  className="mb-4 mt-4 space-y-3 text-sm leading-6 text-gray-600"
                >
                  {planFeatures.features.map((feature, i) => (
                    <li key={i}>
                      <FeatureItem feature={feature} period={period} />
                    </li>
                  ))}
                </ul>
                <div className="mt-auto">
                  <Button
                    variant={
                      planOption === PlanEnum.Business ? "default" : "default"
                    }
                    className={`w-full py-2 text-sm ${
                      planOption === PlanEnum.Business
                        ? "bg-[#fb7a00]/90 text-white hover:bg-[#fb7a00]"
                        : planOption === PlanEnum.DataRoomsPremium
                          ? "bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                          : "bg-gray-800 text-white hover:bg-gray-900 dark:hover:bg-gray-700/80"
                    }`}
                    loading={selectedPlan === planOption}
                    disabled={selectedPlan !== null}
                    onClick={() => {
                      setSelectedPlan(planOption);
                      const envKey =
                        process.env.NEXT_PUBLIC_VERCEL_ENV === "production"
                          ? "production"
                          : "test";
                      const plan = PLANS.find((p) => p.name === planOption);
                      if (!plan) return;
                      const priceId =
                        plan.price[period].priceIds[envKey][
                          isOldAccount ? "old" : "new"
                        ];

                      if (isCustomer && teamPlan !== "free") {
                        fetch(
                          `/api/teams/${teamInfo?.currentTeam?.id}/billing/manage`,
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                              priceId,
                              upgradePlan: true,
                              applyYearlyDiscount: period === "yearly",
                            }),
                          },
                        )
                          .then(async (res) => {
                            if (res.status === 429) {
                              toast.error(
                                "Rate limit exceeded. Please try again later.",
                              );
                              setSelectedPlan(null);
                              return;
                            }

                            const url = await res.json();
                            router.push(url);
                          })
                          .catch((err) => {
                            alert(err);
                            setSelectedPlan(null);
                          });
                      } else {
                        fetch(
                          `/api/teams/${
                            teamInfo?.currentTeam?.id
                          }/billing/upgrade?priceId=${priceId}&applyYearlyDiscount=${period === "yearly"}`,
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                          },
                        )
                          .then(async (res) => {
                            if (res.status === 429) {
                              toast.error(
                                "Rate limit exceeded. Please try again later.",
                              );
                              setSelectedPlan(null);
                              return;
                            }

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
                      : `Upgrade to ${planOption} ${capitalize(period)}`}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Data Rooms Plans (3 in a row) */}
      {planType === "datarooms" && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {[
            PlanEnum.DataRooms,
            PlanEnum.DataRoomsPlus,
            PlanEnum.DataRoomsPremium,
          ].map((planOption) => {
            const planFeatures = getPlanFeatures(planOption, { period });
            const planData = PLANS.find((p) => p.name === planOption);
            if (!planData) return null;

            const monthlyPrice = planData.price.monthly.amount;
            const yearlyPrice = planData.price.yearly.amount;
            const discountedYearlyPrice =
              period === "yearly"
                ? getDiscountedYearlyPrice(yearlyPrice)
                : yearlyPrice;
            const savings =
              period === "yearly"
                ? calculateSavings(monthlyPrice, yearlyPrice)
                : 0;

            return (
              <div
                key={planOption}
                className={`relative flex flex-col rounded-lg border ${
                  planOption === PlanEnum.Business
                    ? "border-[#fb7a00]"
                    : planOption === PlanEnum.DataRoomsPremium
                      ? "border-gray-900 dark:border-gray-200"
                      : planOption === PlanEnum.DataRoomsPlus
                        ? "border-gray-800 dark:border-gray-300"
                        : "border-gray-400"
                } bg-white p-6 shadow-sm dark:bg-gray-900`}
              >
                <div className="mb-4 border-b border-gray-200 pb-2">
                  <h3 className="text-balance text-xl font-medium text-foreground text-gray-900 dark:text-white">
                    {planOption}
                  </h3>
                  {period === "yearly" && savings > 0 && (
                    <span className="absolute right-2 top-2 rounded bg-[#fb7a00]/10 px-2 py-1 text-xs font-medium text-[#fb7a00]">
                      Save €{savings}/year
                    </span>
                  )}
                  {period === "monthly" &&
                    (planOption === PlanEnum.Business ||
                      planOption === PlanEnum.DataRoomsPlus) && (
                      <span className="absolute -top-3 right-4 rounded bg-[#fb7a00] px-2 py-1 text-xs text-white">
                        {planOption === PlanEnum.Business
                          ? "Most popular"
                          : "Best offer"}
                      </span>
                    )}
                </div>

                <div className="mb-2 text-balance text-4xl font-medium tabular-nums text-foreground">
                  €{period === "yearly" ? discountedYearlyPrice : monthlyPrice}
                  <span className="text-base font-normal dark:text-white/75">
                    /month{period === "yearly" && ", billed annually"}
                  </span>
                </div>
                {period === "yearly" && (
                  <>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-sm text-gray-500 line-through">
                        €{yearlyPrice}/month
                      </span>
                      <span className="rounded bg-[#fb7a00]/10 px-2 py-0.5 text-xs font-medium text-[#fb7a00]">
                        30% OFF
                      </span>
                    </div>
                  </>
                )}
                <p className="mt-4 text-sm text-gray-600 dark:text-white">
                  {planFeatures.featureIntro}
                </p>

                <ul
                  role="list"
                  className="mb-4 mt-4 space-y-3 text-sm leading-6 text-gray-600"
                >
                  {planFeatures.features.map((feature, i) => (
                    <li key={i}>
                      <FeatureItem feature={feature} period={period} />
                    </li>
                  ))}
                </ul>
                <div className="mt-auto">
                  <Button
                    variant={
                      planOption === PlanEnum.Business ? "default" : "default"
                    }
                    className={`w-full py-2 text-sm ${
                      planOption === PlanEnum.Business ||
                      planOption === PlanEnum.DataRoomsPlus
                        ? "bg-[#fb7a00]/90 text-white hover:bg-[#fb7a00]"
                        : planOption === PlanEnum.DataRoomsPremium
                          ? "bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                          : "bg-gray-800 text-white hover:bg-gray-900 dark:hover:bg-gray-700/80"
                    }`}
                    loading={selectedPlan === planOption}
                    disabled={selectedPlan !== null}
                    onClick={() => {
                      setSelectedPlan(planOption);
                      const envKey =
                        process.env.NEXT_PUBLIC_VERCEL_ENV === "production"
                          ? "production"
                          : "test";
                      const plan = PLANS.find((p) => p.name === planOption);
                      if (!plan) return;
                      const priceId =
                        plan.price[period].priceIds[envKey][
                          isOldAccount ? "old" : "new"
                        ];

                      if (isCustomer && teamPlan !== "free") {
                        fetch(
                          `/api/teams/${teamInfo?.currentTeam?.id}/billing/manage`,
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                              priceId,
                              upgradePlan: true,
                              applyYearlyDiscount: period === "yearly",
                            }),
                          },
                        )
                          .then(async (res) => {
                            if (res.status === 429) {
                              toast.error(
                                "Rate limit exceeded. Please try again later.",
                              );
                              setSelectedPlan(null);
                              return;
                            }

                            const url = await res.json();
                            router.push(url);
                          })
                          .catch((err) => {
                            alert(err);
                            setSelectedPlan(null);
                          });
                      } else {
                        fetch(
                          `/api/teams/${
                            teamInfo?.currentTeam?.id
                          }/billing/upgrade?priceId=${priceId}&applyYearlyDiscount=${period === "yearly"}`,
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                          },
                        )
                          .then(async (res) => {
                            if (res.status === 429) {
                              toast.error(
                                "Rate limit exceeded. Please try again later.",
                              );
                              setSelectedPlan(null);
                              return;
                            }

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
                      : `Upgrade to ${planOption} ${capitalize(period)}`}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 flex flex-col items-center space-y-2">
        <p className="text-sm text-muted-foreground">
          All plans include unlimited visitors and page by page document
          analytics.
        </p>
        <a
          href="https://cal.com/marcseitz/papermark"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Looking for Papermark Enterprise?
        </a>
      </div>
    </div>
  );
}
