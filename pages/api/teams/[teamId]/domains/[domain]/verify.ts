import { NextApiRequest, NextApiResponse } from "next";

import { checkRateLimit, rateLimiters } from "@/ee/features/security";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import { trackAnalytics } from "@/lib/analytics";
import {
  getConfigResponse,
  getDomainResponse,
  verifyDomain,
} from "@/lib/domains";
import prisma from "@/lib/prisma";
import { CustomUser, DomainVerificationStatusProps } from "@/lib/types";

import { authOptions } from "../../../../auth/[...nextauth]";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // GET /api/teams/:teamId/domains/[domain]/verify - get domain verification status
  const { teamId, domain } = req.query;

  if (typeof teamId !== "string" || typeof domain !== "string") {
    return res
      .status(400)
      .json({ error: "Invalid domain verification request" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const userId = (session.user as CustomUser).id;

  const teamAccess = await prisma.userTeam.findUnique({
    where: {
      userId_teamId: {
        userId,
        teamId,
      },
    },
    select: {
      teamId: true,
    },
  });

  if (!teamAccess) {
    return res.status(401).end("Unauthorized");
  }

  const currentDomain = await prisma.domain.findFirst({
    where: {
      slug: domain,
      teamId,
    },
    select: {
      id: true,
      slug: true,
      verified: true,
    },
  });

  if (!currentDomain) {
    return res.status(404).json("Domain not found");
  }

  const rateLimitResult = await checkRateLimit(
    rateLimiters.domainVerification,
    `${userId}:${teamId}`,
  );

  if (!rateLimitResult.success) {
    return res.status(429).json({
      error: "Too many domain verification requests. Please try again later.",
      remaining: rateLimitResult.remaining,
    });
  }

  const domainSlug = currentDomain.slug;
  let status: DomainVerificationStatusProps = "Valid Configuration";

  const [domainJson, configJson] = await Promise.all([
    getDomainResponse(domainSlug),
    getConfigResponse(domainSlug),
  ]);

  if (domainJson?.error?.code === "not_found") {
    // domain not found on Vercel project
    status = "Domain Not Found";
    return res.status(200).json({
      status,
      response: { domainJson, configJson },
    });
    // unknown error
  } else if (domainJson.error) {
    status = "Unknown Error";
    return res.status(200).json({
      status,
      response: { domainJson, configJson },
    });
  }

  /**
   * Domain has DNS conflicts
   */
  if (configJson?.conflicts.length > 0) {
    status = "Conflicting DNS Records";
    return res.status(200).json({
      status,
      response: { domainJson, configJson },
    });
  }

  /**
   * If domain is not verified, we try to verify now
   */
  if (!domainJson.verified) {
    status = "Pending Verification";
    const verificationJson = await verifyDomain(domainSlug);

    // domain was just verified
    if (verificationJson && verificationJson.verified) {
      status = "Valid Configuration";
    }

    return res.status(200).json({
      status,
      response: { domainJson, configJson },
    });
  }

  if (!configJson.misconfigured) {
    status = "Valid Configuration";

    const updatedDomain = await prisma.domain.update({
      where: {
        id: currentDomain.id,
      },
      data: {
        verified: true,
        lastChecked: new Date(),
      },
      select: {
        verified: true,
      },
    });

    if (!currentDomain.verified && updatedDomain.verified) {
      waitUntil(trackAnalytics({ event: "Domain Verified", slug: domainSlug }));
    }
  } else {
    status = "Invalid Configuration";
    await prisma.domain.update({
      where: {
        id: currentDomain.id,
      },
      data: {
        verified: false,
        lastChecked: new Date(),
      },
    });
  }

  return res.status(200).json({
    status,
    response: { domainJson, configJson },
  });
}
