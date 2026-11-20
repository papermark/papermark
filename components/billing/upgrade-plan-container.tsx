import { useRouter } from "next/router";

import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { CancellationModal } from "@/ee/features/billing/cancellation/components";
import { PlanEnum } from "@/ee/stripe/constants";
import { MoreVertical, SquareXIcon } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import { useAnalytics } from "@/lib/analytics";
import { usePlan } from "@/lib/swr/use-billing";

import Stripe from "@/components/shared/icons/stripe";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UpgradeButton } from "@/components/ui/upgrade-button";

export default function UpgradePlanContainer() {
  const router = useRouter();
  const [loading, setLoading] = useState<boolean>(false);
  const [unpauseLoading, setUnpauseLoading] = useState<boolean>(false);
  const [cancellationModalOpen, setCancellationModalOpen] =
    useState<boolean>(false);
  const { currentTeamId } = useTeam();
  const {
    plan,
    isFree,
    isDataroomsPlus,
    isDataroomsPremium,
    isDataroomsUnlimited,
    isPaused,
    isCancelled,
    startsAt,
    endsAt,
    pauseStartsAt,
    discount,
  } = usePlan({ withDiscount: true });
  const analytics = useAnalytics();

  const goToUpgrade = () => router.push("/settings/billing/upgrade");
  const goToInvoices = () => router.push("/settings/billing/invoices");

  const manageSubscription = async ({
    type,
  }: {
    type:
      | "manage"
      | "invoices"
      | "subscription_update"
      | "payment_method_update"
      | "cancellation";
  }) => {
    if (!currentTeamId) return;

    setLoading(true);
    const toastId = toast.loading("Redirecting to Stripe...");

    try {
      fetch(`/api/teams/${currentTeamId}/billing/manage`, {
        method: "POST",
        body: JSON.stringify({ type }),
        headers: {
          "Content-Type": "application/json",
        },
      })
        .then(async (res) => {
          const url = await res.json();
          router.push(url);
        })
        .catch((err) => {
          toast.error("Failed to open Stripe. Please try again.", {
            id: toastId,
          });
          throw err;
        })
        .finally(() => {
          setLoading(false);
        });
    } catch (error) {
      console.error(error);
      setLoading(false);
    }
  };

  const handleUnpauseSubscription = async () => {
    if (!currentTeamId) return;

    setUnpauseLoading(true);

    try {
      const response = await fetch(
        `/api/teams/${currentTeamId}/billing/unpause`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error("Failed to unpause subscription");
      }

      // Track the unpause event for analytics
      analytics.capture("Subscription Unpaused", {
        teamId: currentTeamId,
        plan: plan,
      });

      toast.success("Subscription unpaused successfully!");
      mutate(`/api/teams/${currentTeamId}/billing/plan`);
      mutate(`/api/teams/${currentTeamId}/billing/plan?withDiscount=true`);
    } catch (error) {
      console.error(error);
    } finally {
      setUnpauseLoading(false);
    }
  };

  const handleReactivateSubscription = async () => {
    if (!currentTeamId) return;
    setUnpauseLoading(true);

    try {
      const response = await fetch(
        `/api/teams/${currentTeamId}/billing/reactivate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error("Failed to reactivate subscription");
      }

      // Track the reactivation event for analytics
      analytics.capture("Subscription Reactivated", {
        teamId: currentTeamId,
        plan: plan,
      });

      toast.success("Subscription reactivated successfully!");
      mutate(`/api/teams/${currentTeamId}/billing/plan`);
      mutate(`/api/teams/${currentTeamId}/billing/plan?withDiscount=true`);
    } catch (error) {
      console.error(error);
    } finally {
      setUnpauseLoading(false);
    }
  };

  const isBillingCycleCurrent = () => {
    if (!startsAt || !endsAt) return false;
    const currentDate = new Date();
    return currentDate >= new Date(startsAt) && currentDate <= new Date(endsAt);
  };

  const getDiscountText = () => {
    if (!discount || !discount.valid) return null;

    let discountText = "";
    if (discount.percentOff) {
      discountText = `${discount.percentOff}% off`;
    } else if (discount.amountOff) {
      discountText = `$${(discount.amountOff / 100).toFixed(2)} off`;
    }

    if (discount.duration === "repeating" && discount.durationInMonths) {
      discountText += ` for ${discount.durationInMonths} month${discount.durationInMonths > 1 ? "s" : ""}`;
    } else if (discount.duration === "once") {
      discountText += " (one-time)";
    }

    return discountText;
  };

  const planTitle = isDataroomsUnlimited
    ? "Unlimited"
    : isDataroomsPremium
      ? "Premium"
      : isDataroomsPlus
        ? "Datarooms+"
        : plan.charAt(0).toUpperCase() + plan.slice(1);

  const BillingPortalItem = () => (
    <DropdownMenuItem
      onClick={() => manageSubscription({ type: "manage" })}
      disabled={loading}
    >
      <Stripe className="h-4 w-4 rounded-[3px]" />
      Open billing portal
    </DropdownMenuItem>
  );

  const ButtonList = () => {
    if (isFree) {
      return (
        <UpgradeButton
          text=""
          customText="Upgrade"
          clickedPlan={PlanEnum.Business}
          trigger="upgrade_plan"
          useModal={false}
          onClick={goToUpgrade}
        />
      );
    }

    if (isCancelled) {
      return (
        <>
          <Button onClick={handleReactivateSubscription} loading={unpauseLoading}>
            Reactivate subscription
          </Button>
          <Button variant="outline" onClick={goToInvoices}>
            View invoices
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 w-9 p-0">
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">More options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <BillingPortalItem />
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      );
    }

    if (isPaused) {
      return (
        <>
          <Button onClick={handleUnpauseSubscription} loading={unpauseLoading}>
            Unpause subscription
          </Button>
          <Button variant="outline" onClick={goToInvoices}>
            View invoices
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 w-9 p-0">
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">More options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <BillingPortalItem />
              <DropdownMenuItem
                onClick={() => manageSubscription({ type: "cancellation" })}
                disabled={loading}
              >
                <SquareXIcon className="h-4 w-4" />
                Cancel subscription
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      );
    }

    return (
      <>
        <Button onClick={goToUpgrade}>Manage plan</Button>
        <Button variant="outline" onClick={goToInvoices}>
          View invoices
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 w-9 p-0">
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">More options</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <BillingPortalItem />
            <DropdownMenuItem onClick={() => setCancellationModalOpen(true)}>
              <SquareXIcon className="h-4 w-4" />
              Cancel subscription
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    );
  };

  return (
    <>
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {planTitle} Plan
            </h2>
            {!isCancelled && startsAt && endsAt && isBillingCycleCurrent() && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                <span className="font-medium text-foreground">
                  Current billing cycle:{" "}
                </span>
                {new Date(startsAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {" - "}
                {new Date(endsAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
            {isPaused && pauseStartsAt && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                <span className="font-medium text-foreground">
                  Subscription{" "}
                  {new Date(pauseStartsAt) > new Date()
                    ? "will pause on"
                    : "paused on"}
                  :{" "}
                </span>
                {new Date(pauseStartsAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
            {isCancelled && endsAt && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                <span className="font-medium text-foreground">
                  Subscription cancels on:{" "}
                </span>
                {new Date(endsAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
            {discount && discount.valid && getDiscountText() && (
              <div className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:ring-green-400/30">
                🎉 {getDiscountText()} applied
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {ButtonList()}
          </div>
        </div>
      </div>

      <CancellationModal
        open={cancellationModalOpen}
        onOpenChange={setCancellationModalOpen}
      />
    </>
  );
}
