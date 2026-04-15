import { NextApiRequest, NextApiResponse } from "next";

import { stripeInstance } from "@/ee/stripe";
import { getCouponFromPlan } from "@/ee/stripe/functions/get-coupon-from-plan";
import { getQuantityFromPriceId } from "@/ee/stripe/functions/get-quantity-from-plan";
import getSubscriptionItem from "@/ee/stripe/functions/get-subscription-item";
import { getPlanFromPriceId, isOldAccount } from "@/ee/stripe/utils";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import { identifyUser, trackAnalytics } from "@/lib/analytics";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

import { authOptions } from "../../../auth/[...nextauth]";

export const config = {
  // in order to enable `waitUntil` function
  supportsResponseStreaming: true,
};

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    // POST /api/teams/:teamId/billing/manage – manage a user's subscription
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const userId = (session.user as CustomUser).id;
    const userEmail = (session.user as CustomUser).email;

    const { teamId } = req.query as { teamId: string };
    const {
      priceId,
      upgradePlan,
      quantity,
      addSeat,
      proAnnualBanner,
      return_url,
      applyYearlyDiscount,
      type = "manage",
    } = req.body as {
      priceId: string;
      upgradePlan: boolean;
      quantity?: number;
      addSeat?: boolean;
      proAnnualBanner?: boolean;
      return_url?: string;
      applyYearlyDiscount?: boolean;
      type?:
        | "manage"
        | "invoices"
        | "subscription_update"
        | "payment_method_update"
        | "cancellation";
    };
    try {
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: userId,
            },
          },
        },
        select: {
          stripeId: true,
          subscriptionId: true,
          plan: true,
        },
      });

      if (!team) {
        return res.status(400).json({ error: "Team does not exists" });
      }
      if (!team.stripeId) {
        return res.status(400).json({ error: "No Stripe customer ID" });
      }

      if (!team.subscriptionId) {
        return res.status(400).json({ error: "No subscription ID" });
      }

      const {
        id: subscriptionItemId,
        currentPeriodStart,
        currentPeriodEnd,
      } = await getSubscriptionItem(
        team.subscriptionId,
        isOldAccount(team.plan),
      );

      const minQuantity = getQuantityFromPriceId(priceId);
      const plan = getPlanFromPriceId(priceId, isOldAccount(team.plan));
      const isUnlimitedPlan = plan?.slug === "datarooms-unlimited";

      const stripe = stripeInstance(isOldAccount(team.plan));
      
      // Apply 30% discount for yearly plans before redirecting to billing portal
      // Same logic as retention flow: apply coupon directly to subscription
      if (applyYearlyDiscount && upgradePlan) {
        const plan = getPlanFromPriceId(priceId, isOldAccount(team.plan));
        if (plan) {
          // Use the same logic as retention flow: getCouponFromPlan(team.plan, isAnnualPlan)
          // team.plan format is "pro", "business", "pro+old", "business+old", etc.
          const planString = `${plan.slug}${isOldAccount(team.plan) ? "+old" : ""}`;
          const couponId = getCouponFromPlan(planString, true);
          
          // Verify coupon exists before applying (coupons might only exist in production, not test mode)
          try {
            await stripe.coupons.retrieve(couponId);
            // Apply discount directly to subscription (same as retention flow)
            await stripe.subscriptions.update(team.subscriptionId, {
              discounts: [{ coupon: couponId }],
            });
          } catch (error: any) {
            // If coupon doesn't exist (common in test mode), log and skip
            if (error.code === "resource_missing") {
              console.warn(
                `[Manage] Coupon "${couponId}" not found in ${process.env.NEXT_PUBLIC_VERCEL_ENV || "test"} mode. ` +
                `Skipping discount application. This is expected if the coupon only exists in production.`
              );
            } else {
              // Re-throw other errors
              throw error;
            }
          }
        }
      }

      const { url } = await stripe.billingPortal.sessions.create({
        customer: team.stripeId,
        return_url: `${process.env.NEXTAUTH_URL}/settings/billing?cancel=true`,
        ...(type === "manage" &&
          (upgradePlan || addSeat) &&
          subscriptionItemId && {
            flow_data: {
              type: "subscription_update_confirm",
              subscription_update_confirm: {
                subscription: team.subscriptionId,
                items: [
                  {
                    id: subscriptionItemId,
                    quantity: isUnlimitedPlan
                      ? 1
                      : isOldAccount(team.plan)
                        ? 1
                        : (quantity ?? minQuantity),
                    price: priceId,
                  },
                ],
              },
              after_completion: {
                type: "redirect",
                redirect: {
                  return_url:
                    return_url ??
                    `${process.env.NEXTAUTH_URL}/settings/billing?success=true`,
                },
              },
            },
          }),
        ...(type === "subscription_update" && {
          flow_data: {
            type: "subscription_update",
            subscription_update: {
              subscription: team.subscriptionId,
            },
          },
        }),
        ...(type === "cancellation" && {
          flow_data: {
            type: "subscription_cancel",
            subscription_cancel: {
              subscription: team.subscriptionId,
            },
            after_completion: {
              type: "redirect",
              redirect: {
                return_url:
                  return_url ??
                  `${process.env.NEXTAUTH_URL}/settings/billing?cancellation=true`,
              },
            },
          },
        }),
      });

      waitUntil(identifyUser(userEmail ?? userId));
      waitUntil(
        trackAnalytics({
          event: "Stripe Billing Portal Clicked",
          teamId,
          action: proAnnualBanner ? "pro-annual-banner" : undefined,
        }),
      );

      return res.status(200).json(url);
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
