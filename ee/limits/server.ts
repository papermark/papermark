import { z } from "zod";

import prisma from "@/lib/prisma";

import {
  BUSINESS_PLAN_LIMITS,
  DATAROOMS_PLAN_LIMITS,
  DATAROOMS_PLUS_PLAN_LIMITS,
  DATAROOMS_PREMIUM_PLAN_LIMITS,
  DATAROOMS_UNLIMITED_PLAN_LIMITS,
  FREE_PLAN_LIMITS,
  PRO_PLAN_LIMITS,
  TFileSizeLimits,
  TPlanLimits,
} from "./constants";

// Function to determine if a plan is free or free+drtrial
const isFreePlan = (plan: string) => plan === "free" || plan === "free+drtrial";
const isTrialPlan = (plan: string) => plan.includes("drtrial");

// Function to get the base plan from a plan string
const getBasePlan = (plan: string) => plan.split("+")[0];

const planLimitsMap: Record<string, TPlanLimits> = {
  free: FREE_PLAN_LIMITS,
  pro: PRO_PLAN_LIMITS,
  business: BUSINESS_PLAN_LIMITS,
  datarooms: DATAROOMS_PLAN_LIMITS,
  "datarooms-plus": DATAROOMS_PLUS_PLAN_LIMITS,
  "datarooms-premium": DATAROOMS_PREMIUM_PLAN_LIMITS,
  "datarooms-unlimited": DATAROOMS_UNLIMITED_PLAN_LIMITS,
};

const optionalNumericLimitSchema = z
  .preprocess(
    (value) =>
      value === null ? Infinity : value !== undefined ? Number(value) : undefined,
    z.number(),
  )
  .optional();

const normalizeFileSizeLimit = (value: number | null | undefined) =>
  value === null ? Infinity : value;

const normalizeFileSizeLimits = (fileSizeLimits?: TFileSizeLimits) => {
  if (!fileSizeLimits) {
    return undefined;
  }

  return {
    video: normalizeFileSizeLimit(fileSizeLimits.video),
    document: normalizeFileSizeLimit(fileSizeLimits.document),
    image: normalizeFileSizeLimit(fileSizeLimits.image),
    excel: normalizeFileSizeLimit(fileSizeLimits.excel),
    maxFiles: normalizeFileSizeLimit(fileSizeLimits.maxFiles),
    maxPages: normalizeFileSizeLimit(fileSizeLimits.maxPages),
  };
};

export const configSchema = z.object({
  datarooms: optionalNumericLimitSchema,
  links: optionalNumericLimitSchema.default(50),
  documents: optionalNumericLimitSchema.default(50),
  users: optionalNumericLimitSchema,
  domains: optionalNumericLimitSchema,
  customDomainOnPro: z.boolean().optional(),
  customDomainInDataroom: z.boolean().optional(),
  advancedLinkControlsOnPro: z.boolean().nullish(),
  watermarkOnBusiness: z.boolean().nullish(),
  agreementOnBusiness: z.boolean().nullish(),
  conversationsInDataroom: z.boolean().nullish(),
  linkCustomFields: z.number().nullish(),
  fileSizeLimits: z
    .object({
      video: optionalNumericLimitSchema, // in MB
      document: optionalNumericLimitSchema, // in MB
      image: optionalNumericLimitSchema, // in MB
      excel: optionalNumericLimitSchema, // in MB
      maxFiles: optionalNumericLimitSchema, // in amount of files
      maxPages: optionalNumericLimitSchema, // in amount of pages
    })
    .optional(),
});

export async function getLimits({
  teamId,
  userId,
}: {
  teamId: string;
  userId: string;
}) {
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
      plan: true,
      limits: true,
      _count: {
        select: {
          documents: true,
          links: true,
          users: true,
          invitations: true,
        },
      },
    },
  });

  if (!team) {
    throw new Error("Team not found");
  }

  const documentCount = team._count.documents;
  const linkCount = team._count.links;
  const userCount = team._count.users + team._count.invitations;

  // parse the limits json with zod and return the limits
  // {datarooms: 1, users: 1, domains: 1, customDomainOnPro: boolean, customDomainInDataroom: boolean}

  try {
    const parsedData = configSchema.parse(team.limits);

    const basePlan = getBasePlan(team.plan);
    const isTrial = isTrialPlan(team.plan);
    const defaultLimits = planLimitsMap[basePlan] || FREE_PLAN_LIMITS;
    const mergedFileSizeLimits = {
      ...(normalizeFileSizeLimits(defaultLimits.fileSizeLimits) ?? {}),
      ...(parsedData.fileSizeLimits ?? {}),
    };
    const hasMergedFileSizeLimits = Object.values(mergedFileSizeLimits).some(
      (value) => value !== undefined,
    );
    const mergedLimits = {
      ...defaultLimits,
      ...parsedData,
      ...(hasMergedFileSizeLimits
        ? { fileSizeLimits: mergedFileSizeLimits }
        : {}),
    };

    // Adjust limits based on the plan if they're at the default value
    if (isFreePlan(team.plan)) {
      return {
        ...mergedLimits,
        usage: { documents: documentCount, links: linkCount, users: userCount },
        ...(isTrial && {
          users: 3,
          datarooms: Math.max(parsedData.datarooms ?? defaultLimits?.datarooms ?? 0, 1),
        }),
      };
    } else {
      return {
        ...mergedLimits,
        // if account is paid, but link and document limits are not set, then set them to Infinity
        links: parsedData.links === 50 ? Infinity : parsedData.links,
        documents:
          parsedData.documents === 50 ? Infinity : parsedData.documents,
        users: parsedData.users ?? (defaultLimits?.users === null ? Infinity : defaultLimits?.users),
        domains: parsedData.domains ?? (defaultLimits?.domains === null ? Infinity : defaultLimits?.domains),
        datarooms: parsedData.datarooms ?? (defaultLimits?.datarooms === null ? Infinity : defaultLimits?.datarooms),
        usage: { documents: documentCount, links: linkCount, users: userCount },
      };
    }
  } catch (error) {
    // if no limits set or parsing fails, return default limits based on the plan
    const basePlan = getBasePlan(team.plan);
    const isTrial = isTrialPlan(team.plan);
    const defaultLimits = planLimitsMap[basePlan] || FREE_PLAN_LIMITS;
    return {
      ...defaultLimits,
      users: defaultLimits.users === null ? Infinity : defaultLimits.users,
      domains: defaultLimits.domains === null ? Infinity : defaultLimits.domains,
      datarooms: defaultLimits.datarooms === null ? Infinity : defaultLimits.datarooms,
      conversationsInDataroom: false,
      usage: { documents: documentCount, links: linkCount, users: userCount },
      ...(isTrial && {
        users: 3,
        datarooms: Math.max(defaultLimits?.datarooms ?? 0, 1),
      }),
    };
  }
}
