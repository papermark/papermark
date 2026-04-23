import { useRouter } from "next/router";

import { useEffect, useMemo, useState } from "react";
import React from "react";

import { useTeam } from "@/context/team-context";
import { getStripe } from "@/ee/stripe/client";
import { PLANS } from "@/ee/stripe/utils";
import { CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useAnalytics } from "@/lib/analytics";
import { usePlan } from "@/lib/swr/use-billing";
import { capitalize, cn } from "@/lib/utils";

import { DataroomTrialModal } from "../datarooms/dataroom-trial-modal";
import X from "../shared/icons/x";
import { Badge } from "../ui/badge";
import { Switch } from "../ui/switch";

export function UpgradePlanModal({
  clickedPlan,
  trigger,
  open,
  setOpen,
  children,
}: {
  clickedPlan: "Data Rooms" | "Business" | "Pro";
  trigger?: string;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<"Pro" | "Business" | "Data Rooms">(
    clickedPlan,
  );
  const [period, setPeriod] = useState<"yearly" | "monthly">("yearly");
  const [clicked, setClicked] = useState<boolean>(false);
  const teamInfo = useTeam();
  const { plan: teamPlan, trial, isCustomer, isOldAccount } = usePlan();
  const analytics = useAnalytics();

  const isTrial = !!trial;

  const features = useMemo(() => {
    if (plan === "Pro") {
      return [
        "2 users included",
        "Custom branding",
        "Folder organization",
        "Require email verification",
        "Papermark branding removed",
        "1-year analytics retention",
      ];
    }

    if (plan === "Business") {
      return [
        "3 users included",
        "1 dataroom",
        "Multi-file sharing",
        <span key="custom-domain">
          Custom domain <b>for documents</b>
        </span>,
        "Advanced link controls",
        "Allow/Block list",
        "Unlimited documents",
        "Unlimited subfolder levels",
        "Large file uploads",
        "48h priority support",
      ];
    }
    if (plan === "Data Rooms") {
      return [
        "3 users included",
        "Unlimited data rooms",
        <span key="custom-dataroom">
          Custom domain <b>for data rooms</b>
        </span>,

        "NDA agreements",
        "Dynamic watermark",
        "Granular user/group permisssions",
        "Advanced data rooms analytics",
        "24h priority support",
        "Custom onboarding",
      ];
    }

    return [
      "2 users",
      "Custom branding",
      "1-year analytics retention",
      "Folders",
    ];
  }, [plan]);

  // Track analytics event when modal is opened
  useEffect(() => {
    if (open) {
      analytics.capture("Upgrade Button Clicked", {
        trigger: trigger,
        teamId: teamInfo?.currentTeam?.id,
      });

      // Track upgrade click for email scheduling (with trigger info for personalization)
      if (teamInfo?.currentTeam?.id) {
        fetch(`/api/teams/${teamInfo.currentTeam.id}/billing/track-upgrade-click`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trigger }),
        }).catch(() => {
          // Silently fail - this is just for tracking
        });
      }
    }
  }, [open, trigger, teamInfo?.currentTeam?.id]);

  // Track analytics event when child button is present
  const handleUpgradeClick = () => {
    analytics.capture("Upgrade Button Clicked", {
      trigger: trigger,
      teamId: teamInfo?.currentTeam?.id,
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
      <DialogContent className="bg-background text-foreground sm:max-w-[600px]">
        <div className="flex flex-col items-center justify-center space-y-3 border-b border-border py-6 sm:px-10">
          <h2 className="text-2xl font-bold">
            Select the best plan for your business
          </h2>
          <Button
            variant="ghost"
            className="absolute right-4 top-4"
            onClick={() => setOpen?.(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex items-center justify-center space-x-2 py-4">
          <span className={cn("mr-2", period === "yearly" && "text-gray-400")}>
            Monthly
          </span>
          <Switch
            checked={period === "yearly"}
            onCheckedChange={(checked) =>
              setPeriod(checked ? "yearly" : "monthly")
            }
            className="h-5 w-10"
          />
          <span className={cn("ml-2", period === "monthly" && "text-gray-400")}>
            Annually{" "}
            <span className="ml-1 text-sm font-normal text-[#fb7a00]">
              (Save up to 25%)
            </span>
          </span>
        </div>

        <div className="space-y-4 px-6 py-4">
          <Tabs
            value={plan}
            onValueChange={(value) => setPlan(value as typeof plan)}
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="Pro">Pro</TabsTrigger>
              <TabsTrigger value="Business">Business</TabsTrigger>
              <TabsTrigger value="Data Rooms">Data Rooms</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="rounded-lg border border-border p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <h4 className="font-medium text-foreground">
                  {plan} {capitalize(period)}
                </h4>
                <Badge
                  variant="outline"
                  className="text-sm font-normal normal-case"
                >
                  {`€${PLANS.find((p) => p.name === plan)!.price[period].amount}/month`}
                  {period === "yearly" && (
                    <span className="ml-1 text-xs">(billed yearly)</span>
                  )}
                </Badge>
              </div>
              <button
                onClick={() =>
                  setPeriod(period === "monthly" ? "yearly" : "monthly")
                }
                className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-gray-800 hover:dark:text-muted-foreground/80"
              >
                {period === "monthly"
                  ? plan === "Business"
                    ? "Want 43% off?"
                    : plan === "Data Rooms"
                      ? "Want 50% off?"
                      : "Want 35% off?"
                  : "Switch to monthly"}
              </button>
            </div>
            <ul className="space-y-2">
              {features.map((feature, i) => (
                <li
                  key={i}
                  className="flex items-center gap-x-3 text-sm text-muted-foreground"
                >
                  <CheckIcon
                    className="h-5 w-5 flex-none text-[#fb7a00]"
                    aria-hidden="true"
                  />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <Button
            className="w-full"
            loading={clicked}
            onClick={() => {
              setClicked(true);
              // @ts-ignore
              // prettier-ignore

              if (isCustomer && teamPlan !== "free") {
                fetch(
                  `/api/teams/${teamInfo?.currentTeam?.id}/billing/manage`,
                  {
                    method: "POST",
                  },
                )
                  .then(async (res) => {
                    const url = await res.json();
                    router.push(url);
                  })
                  .catch((err) => {
                    alert(err);
                    setClicked(false);
                  });
              } else {

              fetch(
                `/api/teams/${
                  teamInfo?.currentTeam?.id
                }/billing/upgrade?priceId=${
                  PLANS.find((p) => p.name === plan)!.price[period].priceIds[
                    process.env.NEXT_PUBLIC_VERCEL_ENV === "production"
                      ? "production"
                      : "test"
                  ]
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
                  setClicked(false);
                });
              }
            }}
          >{`Upgrade to ${plan} ${capitalize(period)}`}</Button>

          <div className="flex items-center justify-center space-x-2 text-center text-xs text-muted-foreground">
            {plan === "Business" && !isTrial ? (
              <DataroomTrialModal>
                <button
                  className="underline-offset-4 transition-all hover:text-gray-800 hover:underline hover:dark:text-muted-foreground/80"
                  onClick={() => analytics.capture("Dataroom Trial Clicked")}
                >
                  Looking for a trial?
                </button>
              </DataroomTrialModal>
            ) : (
              <a
                href="https://cal.com/marcseitz/papermark"
                target="_blank"
                className="underline-offset-4 transition-all hover:text-gray-800 hover:underline hover:dark:text-muted-foreground/80"
              >
                Looking for Papermark Enterprise?
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
