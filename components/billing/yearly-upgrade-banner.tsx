"use client";

import { useRouter } from "next/router";

import { Dispatch, SetStateAction, useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum, getPlanFeatures } from "@/ee/stripe/constants";
import { getPriceIdFromPlan } from "@/ee/stripe/functions/get-price-id-from-plan";
import { PLANS } from "@/ee/stripe/utils";
import Cookies from "js-cookie";
import { CheckIcon, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { usePlan } from "@/lib/swr/use-billing";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";

import { UpgradePlanModal } from "./upgrade-plan-modal";

interface YearlyUpgradeBannerProps {
  setShowBanner: Dispatch<SetStateAction<boolean | null>>;
}

export default function YearlyUpgradeBanner({
  setShowBanner,
}: YearlyUpgradeBannerProps) {
  const router = useRouter();
  const { plan: teamPlan } = usePlan();

  const handleHideBanner = () => {
    setShowBanner(false);
    Cookies.set("hideYearlyUpgradeBanner", "yearly-upgrade-banner", {
      expires: 7,
    });
  };

  // Get next higher plan
  const getNextPlan = () => {
    if (teamPlan === "pro") return PlanEnum.Business;
    if (teamPlan === "business") return PlanEnum.DataRooms;
    if (teamPlan === "datarooms") return PlanEnum.DataRoomsPlus;
    if (teamPlan === "datarooms-plus") return PlanEnum.DataRoomsPremium;
    return null;
  };

  const nextPlan = getNextPlan();

  if (!nextPlan) return null; // Don't show banner if no next plan

  return (
    <AnimatePresence>
      <motion.aside
        initial={{ x: 400, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 400, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className={cn(
          "fixed right-0 top-1/2 z-50 w-80 -translate-y-1/2 rounded-l-lg border-b border-l border-t border-gray-200 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-900",
        )}
      >
        <button
          type="button"
          onClick={handleHideBanner}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>

        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[#fb7a00]" />
          <span className="text-lg font-bold text-black dark:text-white">
            UPGRADE YOUR PLAN
          </span>
        </div>

        <div className="mb-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Save up to 35% with yearly plans
          </p>
        </div>

        {/* Next Plan Card - Orange */}
        {(() => {
          const planData = PLANS.find((p) => p.name === nextPlan);
          if (!planData) return null;

          const yearlyPrice = planData.price.yearly.amount;
          const monthlyPrice = planData.price.monthly.amount;
          const monthlyForYear = monthlyPrice * 12;
          const yearlyForYear = yearlyPrice * 12;
          const savings = monthlyForYear - yearlyForYear;
          const planFeatures = getPlanFeatures(nextPlan, {
            period: "yearly",
            maxFeatures: 4,
          });

          return (
            <div className="rounded-lg border-2 border-[#fb7a00] bg-orange-50 p-3 dark:bg-orange-900/20">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-bold text-[#fb7a00]">
                  RECOMMENDED
                </span>
                {savings > 0 && (
                  <span className="text-xs font-medium text-[#fb7a00]">
                    Save €{savings}/year
                  </span>
                )}
              </div>
              <p className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">
                {nextPlan} plan
              </p>
              <div className="mb-3 flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-gray-900 dark:text-white">
                  €{yearlyPrice}
                </span>
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  /mo, billed annually
                </span>
              </div>

              {/* Features */}
              <ul className="mb-3 space-y-1.5 text-xs text-gray-700 dark:text-gray-300">
                {planFeatures.features.slice(0, 4).map((feature, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <CheckIcon className="h-3.5 w-3.5 flex-shrink-0 text-[#fb7a00]" />
                    <span className="leading-tight">{feature.text}</span>
                  </li>
                ))}
              </ul>

              <UpgradePlanModal
                clickedPlan={nextPlan}
                trigger="yearly_upgrade_banner"
              >
                <Button
                  type="button"
                  size="sm"
                  className="w-full bg-[#fb7a00] py-3 leading-tight text-white hover:bg-[#fb7a00]/90"
                >
                  Upgrade to {nextPlan} Yearly
                </Button>
              </UpgradePlanModal>
            </div>
          );
        })()}

        <p
          onClick={() => router.push("/settings/billing/upgrade")}
          className="mt-4 cursor-pointer text-center text-xs text-gray-500 underline hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300"
        >
          Compare all plans
        </p>
      </motion.aside>
    </AnimatePresence>
  );
}
