import Link from "next/link";
import { useRouter } from "next/router";

import { useEffect, useState } from "react";

import { UnlimitedPlanModal } from "@/components/billing/unlimited-plan-modal";
import { useTeam } from "@/context/team-context";
import { getPriceIdFromPlan } from "@/ee/stripe/functions/get-price-id-from-plan";
import { getQuantityFromPriceId } from "@/ee/stripe/functions/get-quantity-from-plan";
import { toast } from "sonner";

import { useAnalytics } from "@/lib/analytics";
import { usePlan } from "@/lib/swr/use-billing";
import useLimits from "@/lib/swr/use-limits";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AddSeatModal({
  open,
  setOpen,
  children,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const analytics = useAnalytics();
  const { plan: userPlan, planName, isAnnualPlan, isOldAccount } = usePlan();
  const { limits } = useLimits();

  const [quantity, setQuantity] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);

  // Get the minimum quantity for the current plan
  const priceId = getPriceIdFromPlan({
    planSlug: userPlan,
    isOld: isOldAccount,
    period: isAnnualPlan ? "yearly" : "monthly",
  });
  const minQuantity = getQuantityFromPriceId(priceId);

  // Set initial quantity to 1 (adding one seat)
  useEffect(() => {
    if (open) {
      setQuantity(1);
    }
  }, [open]);

  // Calculate the total number of seats after the update
  const totalSeatsAfterUpdate = limits?.users && limits.users !== Infinity
    ? limits.users + quantity
    : quantity;

  const handleDecrement = () => {
    if (quantity > 1) {
      setQuantity(quantity - 1);
    }
  };

  const handleIncrement = () => {
    setQuantity(quantity + 1);
  };

  const handleSubmit = async () => {
    setLoading(true);

    try {
      const response = await fetch(`/api/teams/${teamId}/billing/manage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          priceId,
          quantity: totalSeatsAfterUpdate,
          addSeat: true,
          // return_url: `${process.env.NEXTAUTH_URL}/settings/people?success=true`,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        toast.error("Unable to add seats. Please contact support.");
        setLoading(false);
        return;
      }

      const url = await response.json();

      analytics.capture("Add Seat Clicked", {
        quantity: quantity,
        totalSeats: totalSeatsAfterUpdate,
        teamId,
        plan: userPlan,
      });

      router.push(url);
    } catch (error) {
      toast.error("An error occurred while processing your request.");
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader className="text-start">
          <DialogTitle>Add more seats</DialogTitle>
          <DialogDescription>{planName}</DialogDescription>
        </DialogHeader>
        <div className="py-6">
          <div className="flex items-center justify-center space-x-4">
            <Button
              variant="outline"
              size="icon"
              onClick={handleDecrement}
              disabled={quantity <= 1}
              className="h-10 w-10 rounded-full"
            >
              <span className="text-xl">−</span>
            </Button>

            <div className="w-24">
              <Input
                type="number"
                value={quantity}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  if (!isNaN(value) && value >= 1) {
                    setQuantity(value);
                  }
                }}
                className="text-center text-lg"
                min={1}
              />
            </div>

            <Button
              variant="outline"
              size="icon"
              onClick={handleIncrement}
              className="h-10 w-10 rounded-full"
            >
              <span className="text-xl">+</span>
            </Button>
          </div>

          {limits && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Current limit:{" "}
              {limits.users === Infinity || limits.users === null
                ? "Unlimited"
                : `${limits.users} ${limits.users === 1 ? "user" : "users"}`}
            </p>
          )}

          <p className="mt-2 text-center text-sm">
            Adding <span className="font-semibold">{quantity}</span>{" "}
            {quantity === 1 ? "seat" : "seats"}
          </p>

          <p className="mt-2 text-center text-sm font-medium">
            Total after update: {totalSeatsAfterUpdate}{" "}
            {totalSeatsAfterUpdate === 1 ? "user" : "users"}
          </p>

          {minQuantity > 1 && (
            <p className="mt-2 text-center text-sm text-muted-foreground">
              Minimum quantity for {planName}: {minQuantity} users
            </p>
          )}
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-col sm:justify-center">
          <Button onClick={handleSubmit} className="w-full" disabled={loading}>
            {loading ? "Redirecting..." : "Proceed to checkout"}
          </Button>
          <Link
            href="/settings/upgrade"
            className="block w-full text-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            or upgrade to higher plan
          </Link>
          <UnlimitedPlanModal>
            <p className="cursor-pointer text-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
              Interested in unlimited seats?
            </p>
          </UnlimitedPlanModal>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
