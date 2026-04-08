import Link from "next/link";
import { useRouter } from "next/router";

import { useState } from "react";
import React from "react";

import { useTeam } from "@/context/team-context";
import { getStripe } from "@/ee/stripe/client";
import { PlanEnum, getPlanFeatures } from "@/ee/stripe/constants";
import { getPriceIdFromPlan } from "@/ee/stripe/functions/get-price-id-from-plan";
import { PLANS } from "@/ee/stripe/utils";
import { CheckIcon } from "lucide-react";

import { usePlan } from "@/lib/swr/use-billing";
import { capitalize } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

export function UnlimitedPlanModal({
  children,
  period: externalPeriod,
  open: controlledOpen,
  setOpen: controlledSetOpen,
}: {
  children?: React.ReactNode;
  period?: "monthly" | "yearly";
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const [internalPeriod, setInternalPeriod] = useState<"yearly" | "monthly">(
    externalPeriod ?? "yearly",
  );
  const [loading, setLoading] = useState(false);
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { plan: teamPlan, isCustomer, isOldAccount } = usePlan();

  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledSetOpen ?? setInternalOpen;
  const period = internalPeriod;

  const unlimitedPlan = PLANS.find(
    (p) => p.name === PlanEnum.DataRoomsUnlimited,
  )!;
  const planFeatures = getPlanFeatures(PlanEnum.DataRoomsUnlimited, {
    period,
  });

  const handleUpgrade = () => {
    const priceId = getPriceIdFromPlan({
      planName: PlanEnum.DataRoomsUnlimited,
      period,
      isOld: isOldAccount,
    });

    setLoading(true);
    if (isCustomer && teamPlan !== "free") {
      fetch(`/api/teams/${teamId}/billing/manage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId, upgradePlan: true }),
      })
        .then(async (res) => {
          const url = await res.json();
          router.push(url);
        })
        .catch((err) => {
          alert(err);
          setLoading(false);
        });
    } else {
      fetch(`/api/teams/${teamId}/billing/upgrade?priceId=${priceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
        .then(async (res) => {
          const data = await res.json();
          const { id: sessionId } = data;
          const stripe = await getStripe(isOldAccount);
          stripe?.redirectToCheckout({ sessionId });
        })
        .catch((err) => {
          alert(err);
          setLoading(false);
        });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="max-h-[90vh] min-h-fit overflow-y-auto bg-gray-50 text-foreground dark:bg-gray-900"
        style={{ width: "90vw", maxWidth: "520px" }}
      >
        <DialogTitle className="sr-only">Data Rooms Unlimited</DialogTitle>

        <div className="flex items-center justify-center">
          <span className="mr-2 text-sm">Monthly</span>
          <Switch
            checked={internalPeriod === "yearly"}
            onCheckedChange={() =>
              setInternalPeriod(
                internalPeriod === "monthly" ? "yearly" : "monthly",
              )
            }
          />
          <span className="ml-2 text-sm">
            Annually{" "}
            <span className="text-[#fb7a00]">(Save up to 35%)</span>
          </span>
        </div>

        <div className="rounded-xl p-4">
          <div className="relative flex flex-col rounded-lg border border-gray-900 bg-white p-6 shadow-sm dark:border-gray-200 dark:bg-gray-900">
            <span className="absolute -top-3 right-4 rounded bg-gray-900 px-2 py-1 text-xs text-white dark:bg-gray-200 dark:text-gray-900">
              Unlimited
            </span>

            <div className="mb-4 border-b border-gray-200 pb-2">
              <h3 className="text-xl font-medium text-gray-900 dark:text-white">
                Data Rooms Unlimited
              </h3>
            </div>

            <div className="mb-2">
              <span className="text-4xl font-medium tabular-nums text-gray-900 dark:text-white">
                €{unlimitedPlan.price[period].amount}
              </span>
              <span className="text-gray-500 dark:text-white/75">
                /month{period === "yearly" && ", billed annually"}
              </span>
            </div>

            <p className="mt-4 text-sm text-gray-600 dark:text-white">
              {planFeatures.featureIntro}
            </p>

            <ul className="mb-6 mt-2 space-y-2 text-sm leading-6 text-gray-600 dark:text-muted-foreground">
              {planFeatures.features.map((feature, i) => (
                <li key={i} className="flex items-center gap-x-3">
                  <CheckIcon className="h-5 w-5 flex-shrink-0 text-[#fb7a00]" />
                  <span>{feature.text}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto">
              <Button
                className="w-full bg-gray-800 py-2 text-sm text-white hover:bg-gray-900 hover:text-white dark:hover:bg-gray-700/80"
                loading={loading}
                onClick={handleUpgrade}
              >
                {loading
                  ? "Redirecting to Stripe..."
                  : `Upgrade to Unlimited ${capitalize(period)}`}
              </Button>
            </div>
          </div>
        </div>

        <div className="-mt-2 text-center text-sm text-muted-foreground">
          <p>The only data room plan on the market with no limits!</p>
          <Link
            href="https://cal.com/marcseitz/papermark"
            target="_blank"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Book a demo to learn more
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
