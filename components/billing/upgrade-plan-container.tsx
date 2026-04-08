import { useRouter } from "next/router";

import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { CancellationModal } from "@/ee/features/billing/cancellation/components";
import { PlanEnum } from "@/ee/stripe/constants";
import {
  BanIcon,
  CirclePauseIcon,
  CreditCardIcon,
  MoreVertical,
  ReceiptTextIcon,
} from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import { useAnalytics } from "@/lib/analytics";
import { usePlan } from "@/lib/swr/use-billing";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    isCustomer,
    startsAt,
    endsAt,
    pauseStartsAt,
    pauseEndsAt,
    discount,
    mutate: mutatePlan,
  } = usePlan({ withDiscount: true });
  const analytics = useAnalytics();

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
          throw err;
        })
        .finally(() => {
          setLoading(false);
        });
    } catch (error) {
      console.error(error);
    } finally {
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

  const ButtonList = () => {
    if (isFree) {
      return (
        <div className="flex items-center gap-3">
          <UpgradeButton
            text=""
            customText="Upgrade"
            clickedPlan={PlanEnum.Business}
            trigger="upgrade_plan"
            useModal={false}
            onClick={() => router.push("/settings/upgrade")}
          />
        </div>
      );
    } else if (isCancelled) {
      return (
        <Button onClick={handleReactivateSubscription} loading={unpauseLoading}>
          Reactivate subscription
        </Button>
      );
    } else {
      return (
        <div className="flex items-center gap-3">
          {isPaused ? (
            <>
              <Button
                onClick={handleUnpauseSubscription}
                loading={unpauseLoading}
              >
                Unpause subscription
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 w-9 p-0">
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">More options</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => manageSubscription({ type: "cancellation" })}
                    className="text-red-500"
                  >
                    <BanIcon className="h-4 w-4" />
                    Cancel subscription
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setCancellationModalOpen(true)}
              >
                Cancel subscription
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  manageSubscription({ type: "subscription_update" })
                }
                loading={loading}
              >
                Change plan
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 w-9 p-0">
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">More options</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => manageSubscription({ type: "manage" })}
                  >
                    <CreditCardIcon className="h-4 w-4" />
                    Change billing information
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      );
    }
  };

  return (
    <>
      <div className="rounded-lg">
        <Card className="bg-transparent">
          <CardHeader>
            <CardTitle>
              {isDataroomsUnlimited
                ? "Unlimited"
                : isDataroomsPremium
                  ? "Premium"
                  : isDataroomsPlus
                    ? "Datarooms+"
                    : plan.charAt(0).toUpperCase() + plan.slice(1)}{" "}
              Plan
            </CardTitle>
            {!isCancelled && startsAt && endsAt && isBillingCycleCurrent() && (
              <CardDescription>
                <span className="font-medium text-foreground">
                  Current billing cycle:{" "}
                </span>
                <span className="text-foreground">
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
                </span>
              </CardDescription>
            )}
            {isPaused && pauseStartsAt && (
              <CardDescription>
                <span className="font-medium text-foreground">
                  Subscription{" "}
                  {new Date(pauseStartsAt) > new Date()
                    ? "will pause on"
                    : "paused on"}
                  :{" "}
                </span>
                <span className="text-foreground">
                  {new Date(pauseStartsAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </CardDescription>
            )}
            {isCancelled && endsAt && (
              <CardDescription>
                <span className="font-medium text-foreground">
                  Subscription cancels on:{" "}
                </span>
                <span className="text-foreground">
                  {new Date(endsAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </CardDescription>
            )}
            {discount && discount.valid && getDiscountText() && (
              <CardDescription>
                <div className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:ring-green-400/30">
                  🎉 {getDiscountText()} applied
                </div>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent></CardContent>
          <CardFooter className="flex items-center justify-end rounded-b-lg border-t px-6 py-3">
            <div className="shrink-0">{ButtonList()}</div>
          </CardFooter>
        </Card>
      </div>

      <CancellationModal
        open={cancellationModalOpen}
        onOpenChange={setCancellationModalOpen}
      />
    </>
  );
}
