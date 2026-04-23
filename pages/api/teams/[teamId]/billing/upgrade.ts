import { NextApiRequest, NextApiResponse } from "next";

import { checkRateLimit, rateLimiters } from "@/ee/features/security";
import { stripeInstance } from "@/ee/stripe";
import { getCouponFromPlan } from "@/ee/stripe/functions/get-coupon-from-plan";
import { getPlanFromPriceId, isOldAccount } from "@/ee/stripe/utils";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import { identifyUser, trackAnalytics } from "@/lib/analytics";
import { getDubDiscountForExternalUserId } from "@/lib/dub";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { sendAbandonedCheckoutEmailTask } from "@/lib/trigger/send-scheduled-email";
import { CustomUser } from "@/lib/types";
import { getIpAddress } from "@/lib/utils/ip";

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
    // Apply rate limiting
    const clientIP = getIpAddress(req.headers);
    const rateLimitResult = await checkRateLimit(
      rateLimiters.billing,
      clientIP,
    );

    if (!rateLimitResult.success) {
      return res.status(429).json({
        error: "Too many billing requests. Please try again later.",
        remaining: rateLimitResult.remaining,
      });
    }

    // POST /api/teams/:teamId/billing/upgrade
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const { teamId, priceId, applyYearlyDiscount } = req.query as {
      teamId: string;
      priceId: string;
      applyYearlyDiscount?: string;
    };

    const { id: userId, email: userEmail, name: userName } = session.user as CustomUser;

    const team = await prisma.team.findUnique({
      where: {
        id: teamId,
        users: {
          some: {
            userId,
          },
        },
      },
      select: { stripeId: true, plan: true },
    });

    if (!team) {
      res.status(404).end("Unauthorized");
      return;
    }

    const oldAccount = isOldAccount(team.plan);
    const plan = getPlanFromPriceId(priceId, oldAccount);

    if (!plan) {
      res.status(400).json({ error: "Invalid price ID" });
      return;
    }

    const minimumQuantity = plan.minQuantity;

    let stripeSession;
    let couponId: string | undefined;

    // Apply 30% coupon for yearly plans if requested (same as retention flow)
    // Since the upgrade modal is yearly-only, if applyYearlyDiscount is true, always apply
    if (applyYearlyDiscount === "true") {
      // Use the same logic as retention flow: getCouponFromPlan(team.plan, isAnnualPlan)
      // team.plan format is "pro", "business", "pro+old", "business+old", etc.
      const planString = oldAccount ? `${plan.slug}+old` : plan.slug;
      couponId = getCouponFromPlan(planString, true);
      
      // Verify coupon exists in Stripe (coupons might only exist in production, not test mode)
      const stripe = stripeInstance(oldAccount);
      try {
        await stripe.coupons.retrieve(couponId);
      } catch (error: any) {
        // If coupon doesn't exist (common in test mode), continue without discount
        if (error.code === "resource_missing") {
          console.warn(
            `[Upgrade] Coupon "${couponId}" not found in ${process.env.NEXT_PUBLIC_VERCEL_ENV || "test"} mode. ` +
            `Continuing without discount. This is expected if the coupon only exists in production.`
          );
          couponId = undefined;
        } else {
          // Re-throw other errors
          throw error;
        }
      }
    }

    const isUnlimitedPlan = plan.slug === "datarooms-unlimited";

    const lineItem = {
      price: priceId,
      quantity: isUnlimitedPlan ? 1 : oldAccount ? 1 : minimumQuantity,
      ...(!oldAccount &&
        !isUnlimitedPlan && {
          adjustable_quantity: {
            enabled: true,
            minimum: minimumQuantity,
            maximum: 99,
          },
        }),
    };

    const dubDiscount = await getDubDiscountForExternalUserId(userId);

    const stripe = stripeInstance(oldAccount);
    const baseSessionConfig = {
      billing_address_collection: "required" as const,
      success_url: `${process.env.NEXTAUTH_URL}/settings/billing?success=true`,
      cancel_url: `${process.env.NEXTAUTH_URL}/settings/billing?cancel=true`,
      line_items: [lineItem],
      automatic_tax: {
        enabled: true,
      },
      tax_id_collection: {
        enabled: true,
      },
      mode: "subscription" as const,
      client_reference_id: teamId,
      ...(couponId && {
        discounts: [{ coupon: couponId }],
      }),
    };

    if (team.stripeId) {
      // if the team already has a stripeId (i.e. is a customer) let's use as a customer
      stripeSession = await stripe.checkout.sessions.create({
        ...baseSessionConfig,
        customer: team.stripeId,
        customer_update: { name: "auto" },
        ...(!couponId && { allow_promotion_codes: true }),
      });
    } else {
      // else initialize a new customer
      stripeSession = await stripe.checkout.sessions.create({
        ...baseSessionConfig,
        customer_email: userEmail ?? undefined,
        ...(dubDiscount ?? (!couponId && { allow_promotion_codes: true })),
        metadata: {
          dubCustomerId: userId,
        },
      });
    }

    // Mark that user proceeded to checkout (for upgrade intent email check)
    const checkoutStartedKey = `checkout:started:${teamId}`;
    await redis.set(checkoutStartedKey, "1", { ex: 3 * 24 * 60 * 60 }); // Expires in 3 days

    waitUntil(
      Promise.all([
        identifyUser(userEmail ?? userId),
        trackAnalytics({
          event: "Stripe Checkout Clicked",
          teamId,
          priceId: priceId,
        }),
      ]),
    );

    // Schedule abandoned checkout email to be sent in 1 hour
    // The task will check if the team has already upgraded before sending
    waitUntil(
      sendAbandonedCheckoutEmailTask.trigger(
        {
          to: userEmail as string,
          name: userName as string,
          teamId,
        },
        {
          delay: "1h",
        },
      ),
    );

    return res.status(200).json(stripeSession);
  } else {
    // We only allow POST requests
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
