import { NextApiResponse } from "next";

import {
  BUSINESS_PLAN_LIMITS,
  DATAROOMS_PLAN_LIMITS,
  DATAROOMS_PLUS_PLAN_LIMITS,
  DATAROOMS_PREMIUM_PLAN_LIMITS,
  DATAROOMS_UNLIMITED_PLAN_LIMITS,
  PRO_PLAN_LIMITS,
} from "@/ee/limits/constants";
import Stripe from "stripe";

import { clearTeamDomainRedirects } from "@/lib/api/domains/clear-team-redirects";
import { planSupportsRedirects } from "@/lib/api/domains/redis";
import prisma from "@/lib/prisma";
import { log } from "@/lib/utils";

import { getPlanFromPriceId } from "../utils";

export async function customerSubsciptionUpdated(
  event: Stripe.Event,
  res: NextApiResponse,
  isOldAccount: boolean = false,
) {
  const subscriptionUpdated = event.data.object as Stripe.Subscription;
  const priceId = subscriptionUpdated.items.data[0].price.id;

  const plan = getPlanFromPriceId(priceId, isOldAccount);

  if (!plan) {
    await log({
      message: `Invalid price ID in customer.subscription.updated event: ${priceId}, isOldAccount: ${isOldAccount}. Skipping webhook processing to prevent unintended plan changes.`,
      type: "error",
    });
    return res.status(200).json({ received: true });
  }

  const stripeId = subscriptionUpdated.customer.toString();

  const team = await prisma.team.findUnique({
    where: { stripeId },
  });

  if (!team) {
    await log({
      message:
        "Team with Stripe ID *`" +
        stripeId +
        "`* not found in Stripe webhook `customer.subscription.updated` callback",
      type: "error",
    });
    return res.status(200).json({ received: true });
  }

  const newPlan = plan.slug;
  const subscriptionId = subscriptionUpdated.id;
  const startsAt = new Date(subscriptionUpdated.current_period_start * 1000);
  const endsAt = new Date(subscriptionUpdated.current_period_end * 1000);
  const quantity = subscriptionUpdated.items.data[0].quantity;

  let teamPlan = team.plan;
  if (isOldAccount) {
    // remove +old from plan
    teamPlan = teamPlan.replace("+old", "");
  }
  // If a team upgrades/downgrades their subscription, update their plan
  if (teamPlan !== newPlan) {
    // Choose the correct plan limits
    let planLimits:
      | typeof PRO_PLAN_LIMITS
      | typeof BUSINESS_PLAN_LIMITS
      | typeof DATAROOMS_PLAN_LIMITS
      | typeof DATAROOMS_PLUS_PLAN_LIMITS
      | typeof DATAROOMS_PREMIUM_PLAN_LIMITS
      | typeof DATAROOMS_UNLIMITED_PLAN_LIMITS = structuredClone(PRO_PLAN_LIMITS);
    if (plan.slug === "pro") {
      planLimits = structuredClone(PRO_PLAN_LIMITS);
    } else if (plan.slug === "business") {
      planLimits = structuredClone(BUSINESS_PLAN_LIMITS);
    } else if (plan.slug === "datarooms") {
      planLimits = structuredClone(DATAROOMS_PLAN_LIMITS);
    } else if (plan.slug === "datarooms-plus") {
      planLimits = structuredClone(DATAROOMS_PLUS_PLAN_LIMITS);
    } else if (plan.slug === "datarooms-premium") {
      planLimits = structuredClone(DATAROOMS_PREMIUM_PLAN_LIMITS);
    } else if (plan.slug === "datarooms-unlimited") {
      planLimits = structuredClone(DATAROOMS_UNLIMITED_PLAN_LIMITS);
    }

    // Update the user limit in planLimits based on the subscription quantity
    planLimits.users =
      typeof quantity === "number" && quantity > 1
        ? quantity
        : planLimits.users;

    // Update the user with the subscription information and stripeId
    await prisma.team.update({
      where: { stripeId },
      data: {
        plan: `${plan.slug}${isOldAccount ? "+old" : ""}`,
        subscriptionId,
        startsAt,
        endsAt,
        limits: planLimits,
      },
    });

    if (!planSupportsRedirects(newPlan)) {
      await clearTeamDomainRedirects(team.id);
    }
  }

  // If new account, and the plan is the same, but the quantity is different, update the quantity
  if (
    !isOldAccount &&
    teamPlan === newPlan &&
    (team.limits as any)?.users !== quantity
  ) {
    // Update the user limit in planLimits based on the subscription quantity
    const newLimits = team.limits as any;
    newLimits.users = quantity;
    await prisma.team.update({
      where: { stripeId },
      data: {
        plan: plan.slug,
        subscriptionId,
        startsAt,
        endsAt,
        limits: newLimits,
      },
    });
  }

  // Update the subscription start and end dates
  await prisma.team.update({
    where: { stripeId },
    data: {
      startsAt,
      endsAt,
    },
  });
}
