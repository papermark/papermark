import { useRouter } from "next/router";

import { useEffect, useMemo, useState } from "react";
import React from "react";

import { UnlimitedPlanModal } from "@/components/billing/unlimited-plan-modal";
import { useTeam } from "@/context/team-context";
import { getStripe } from "@/ee/stripe/client";
import { Feature, PlanEnum, getPlanFeatures } from "@/ee/stripe/constants";
import { PLANS } from "@/ee/stripe/utils";
import { CheckIcon, InfinityIcon, Users2Icon, XIcon } from "lucide-react";
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
  showBusinessDatarooms,
}: {
  value: "documents" | "datarooms" | "business-datarooms";
  onChange: (value: "documents" | "datarooms") => void;
  showBusinessDatarooms?: boolean;
}) => {
  const isDocuments = value === "documents";
  const isDatarooms = value === "datarooms";
  const isBusinessDatarooms = value === "business-datarooms";

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


export default function UpgradePage() {
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
  const [planType, setPlanType] = useState<"documents" | "datarooms" | "business-datarooms">(getInitialView());

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
        Select best plan for your business
      </h1>

      <div className="mb-8 flex items-center justify-center">
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

      {/* Plan Type Selector */}
      <div className="mb-2 flex justify-center">
        <PlanTypeSelector 
          value={planType} 
          onChange={(value) => setPlanType(value)} 
        />
      </div>

      {planType !== "documents" && (
        <div className="mb-8 text-center">
          <UnlimitedPlanModal period={period}>
            <p className="cursor-pointer text-sm text-muted-foreground transition-colors hover:text-foreground">
              Deals with everything unlimited?{" "}
              <span className="font-light underline underline-offset-4">
                Get unlimited members, storage, and data rooms in one plan.
              </span>
            </p>
          </UnlimitedPlanModal>
        </div>
      )}

      {/* Document Sharing Plans (3 in a row) */}
      {planType === "documents" && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3 mb-8">
          {documentSharingPlans.map((planOption) => {
          const planFeatures = getPlanFeatures(planOption, { period });

          return (
            <div
              key={planOption}
              className={`relative flex flex-col rounded-lg border ${
                planOption === PlanEnum.Business || planOption === PlanEnum.DataRoomsPlus
                  ? "border-[#fb7a00]"
                  : planOption === PlanEnum.DataRoomsPremium
                    ? "border-gray-900 dark:border-gray-200"
                    : "border-gray-400"
              } bg-white p-6 shadow-sm dark:bg-gray-900`}
            >
              <div className="mb-4 border-b border-gray-200 pb-2 dark:border-gray-700">
                <h3 className="text-balance text-xl font-medium text-foreground text-gray-900 dark:text-white">
                  {planOption}{" "}
                  {planOption === PlanEnum.Pro && (
                    <span className="text-xs font-normal text-muted-foreground">
                      All plans include unlimited visitors
                    </span>
                  )}
                </h3>
                {(planOption === PlanEnum.Business ||
                  planOption === PlanEnum.DataRoomsPlus) && (
                  <span
                    className="absolute -top-3 right-4 rounded bg-[#fb7a00] px-2 py-1 text-xs text-white"
                  >
                    {planOption === PlanEnum.DataRoomsPlus
                      ? "Best offer"
                      : "Most popular"}
                  </span>
                )}
              </div>

              <div className="mb-2 text-balance text-4xl font-medium tabular-nums text-foreground">
                €
                {PLANS.find((p) => p.name === planOption)!.price[period].amount}
                <span className="text-base font-normal dark:text-white/75">
                  /month{period === "yearly" && ", billed annually"}
                </span>
              </div>
              <p className="mt-4 text-sm text-gray-600 dark:text-white">
                {planFeatures.featureIntro}
              </p>

              <ul
                role="list"
                className="mb-4 mt-4 space-y-3 text-sm leading-6 text-gray-600 dark:text-gray-300"
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
                    planOption === PlanEnum.Business || planOption === PlanEnum.DataRoomsPlus
                      ? "bg-[#fb7a00]/90 text-white hover:bg-[#fb7a00]"
                      : planOption === PlanEnum.DataRoomsPremium
                        ? "bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                        : "bg-gray-800 text-white hover:bg-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                  }`}
                  loading={selectedPlan === planOption}
                  disabled={selectedPlan !== null}
                  onClick={() => {
                    setSelectedPlan(planOption);
                    if (isCustomer && teamPlan !== "free") {
                      fetch(
                        `/api/teams/${teamInfo?.currentTeam?.id}/billing/manage`,
                        {
                          method: "POST",
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
                        }/billing/upgrade?priceId=${
                          PLANS.find((p) => p.name === planOption)!.price[
                            period
                          ].priceIds[
                            process.env.NEXT_PUBLIC_VERCEL_ENV === "production"
                              ? "production"
                              : "test"
                          ][isOldAccount ? "old" : "new"]
                        }`,
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

            return (
              <div
                key={planOption}
                className={`relative flex flex-col rounded-lg border ${
                  planOption === PlanEnum.Business || planOption === PlanEnum.DataRoomsPlus
                    ? "border-[#fb7a00]"
                    : planOption === PlanEnum.DataRoomsPremium
                      ? "border-gray-900 dark:border-gray-200"
                      : "border-gray-400"
                } bg-white p-6 shadow-sm dark:bg-gray-900`}
              >
                <div className="mb-4 border-b border-gray-200 pb-2 dark:border-gray-700">
                  <h3 className="text-balance text-xl font-medium text-foreground text-gray-900 dark:text-white">
                    {planOption}
                  </h3>
                  {(planOption === PlanEnum.Business ||
                    planOption === PlanEnum.DataRoomsPlus) && (
                    <span
                      className="absolute -top-3 right-4 rounded bg-[#fb7a00] px-2 py-1 text-xs text-white"
                    >
                      {planOption === PlanEnum.DataRoomsPlus
                        ? "Best offer"
                        : "Most popular"}
                    </span>
                  )}
                </div>

                <div className="mb-2 text-balance text-4xl font-medium tabular-nums text-foreground">
                  €
                  {PLANS.find((p) => p.name === planOption)!.price[period]
                    .amount}
                  <span className="text-base font-normal dark:text-white/75">
                    /month{period === "yearly" && ", billed annually"}
                  </span>
                </div>
                <p className="mt-4 text-sm text-gray-600 dark:text-white">
                  {planFeatures.featureIntro}
                </p>

                <ul
                  role="list"
                  className="mb-4 mt-4 space-y-3 text-sm leading-6 text-gray-600 dark:text-gray-300"
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
                      planOption === PlanEnum.Business || planOption === PlanEnum.DataRoomsPlus
                        ? "bg-[#fb7a00]/90 text-white hover:bg-[#fb7a00]"
                        : planOption === PlanEnum.DataRoomsPremium
                          ? "bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                          : "bg-gray-800 text-white hover:bg-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                    }`}
                    loading={selectedPlan === planOption}
                    disabled={selectedPlan !== null}
                    onClick={() => {
                      setSelectedPlan(planOption);
                      if (isCustomer && teamPlan !== "free") {
                        fetch(
                          `/api/teams/${teamInfo?.currentTeam?.id}/billing/manage`,
                          {
                            method: "POST",
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
                          }/billing/upgrade?priceId=${
                            PLANS.find((p) => p.name === planOption)!.price[
                              period
                            ].priceIds[
                              process.env.NEXT_PUBLIC_VERCEL_ENV ===
                                "production"
                                ? "production"
                                : "test"
                            ][isOldAccount ? "old" : "new"]
                          }`,
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
        <>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {[
            PlanEnum.DataRooms,
            PlanEnum.DataRoomsPlus,
            PlanEnum.DataRoomsPremium,
          ].map((planOption) => {
            const planFeatures = getPlanFeatures(planOption, { period });

              return (
                <div
                  key={planOption}
                  className={`relative flex flex-col rounded-lg border ${
                    planOption === PlanEnum.DataRoomsPlus
                      ? "border-[#fb7a00]"
                      : planOption === PlanEnum.DataRoomsPremium
                        ? "border-gray-900 dark:border-gray-200"
                        : "border-gray-400"
                  } bg-white p-6 shadow-sm dark:bg-gray-900`}
                >
                  <div className="mb-4 border-b border-gray-200 pb-2 dark:border-gray-700">
                    <h3 className="text-balance text-xl font-medium text-foreground text-gray-900 dark:text-white">
                      {planOption}
                    </h3>
                    {planOption === PlanEnum.DataRoomsPlus && (
                      <span className="absolute -top-3 right-4 rounded bg-[#fb7a00] px-2 py-1 text-xs text-white">
                        Best offer
                      </span>
                    )}
                  </div>

                  <div className="mb-2 text-balance text-4xl font-medium tabular-nums text-foreground">
                    €
                    {PLANS.find((p) => p.name === planOption)!.price[period]
                      .amount}
                    <span className="text-base font-normal dark:text-white/75">
                      /month{period === "yearly" && ", billed annually"}
                    </span>
                  </div>
                  <p className="mt-4 text-sm text-gray-600 dark:text-white">
                    {planFeatures.featureIntro}
                  </p>

                  <ul
                    role="list"
                    className="mb-4 mt-4 space-y-3 text-sm leading-6 text-gray-600 dark:text-gray-300"
                  >
                    {planFeatures.features.map((feature, i) => (
                      <li key={i}>
                        <FeatureItem feature={feature} period={period} />
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto">
                    <Button
                      className={`w-full py-2 text-sm ${
                        planOption === PlanEnum.DataRoomsPlus
                          ? "bg-[#fb7a00]/90 text-white hover:bg-[#fb7a00]"
                          : planOption === PlanEnum.DataRoomsPremium
                            ? "bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                            : "bg-gray-800 text-white hover:bg-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                      }`}
                      loading={selectedPlan === planOption}
                      disabled={selectedPlan !== null}
                      onClick={() => {
                        setSelectedPlan(planOption);
                        if (isCustomer && teamPlan !== "free") {
                          fetch(
                            `/api/teams/${teamInfo?.currentTeam?.id}/billing/manage`,
                            {
                              method: "POST",
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
                            }/billing/upgrade?priceId=${
                              PLANS.find((p) => p.name === planOption)!.price[
                                period
                              ].priceIds[
                                process.env.NEXT_PUBLIC_VERCEL_ENV ===
                                  "production"
                                  ? "production"
                                  : "test"
                              ][isOldAccount ? "old" : "new"]
                            }`,
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

        {/* Unlimited Plan Banner */}
        <UnlimitedPlanModal period={period}>
          <div className="mt-6 cursor-pointer rounded-xl border-2 border-gray-900 bg-white px-6 py-10 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-200 dark:bg-gray-900 dark:hover:bg-gray-800 md:px-8 md:py-20">
            <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4 md:gap-5">
                <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full border-2 border-gray-900 bg-transparent dark:border-gray-200">
                  <InfinityIcon className="h-6 w-6 text-gray-900 dark:text-gray-200" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white md:text-xl">
                    Data Rooms Unlimited
                  </h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Unlimited members, documents, storage, data rooms with no seat limits.
                  </p>
                </div>
              </div>
              <div className="flex w-full flex-col items-start gap-4 md:w-auto md:flex-row md:items-center md:gap-8">
                <div className="md:text-right">
                  <span className="text-3xl font-semibold tabular-nums text-gray-900 dark:text-white md:text-4xl">
                    €{PLANS.find((p) => p.name === PlanEnum.DataRoomsUnlimited)!.price[period].amount}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    /month{period === "yearly" && ", billed annually"}
                  </span>
                </div>
                <Button size="lg" className="w-full bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200 md:w-auto">
                  Get Unlimited
                </Button>
              </div>
            </div>
          </div>
        </UnlimitedPlanModal>
        </>
      )}

      <div className="mt-8 flex flex-col items-center">
        <a
          href="https://cal.com/marcseitz/papermark"
          target="_blank"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Looking for Papermark Enterprise?
        </a>
      </div>
    </div>
  );
}
