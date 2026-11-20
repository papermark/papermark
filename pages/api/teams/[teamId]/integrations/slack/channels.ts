import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";
import { z } from "zod";

import {
  SlackRateLimitError,
  getSlackClient,
} from "@/lib/integrations/slack/client";
import { getSlackEnv } from "@/lib/integrations/slack/env";
import { SlackCredential } from "@/lib/integrations/slack/types";
import { slackChannelsCacheKey } from "@/lib/integrations/slack/utils";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { CustomUser } from "@/lib/types";

export const config = {
  maxDuration: 300,
};

// Channel lists rarely change, so cache them to avoid re-paginating Slack's
// rate-limited conversations.list on every settings page visit / SWR retry.
const CHANNELS_CACHE_TTL_SECONDS = 600; // 10 minutes

type AvailableChannel = {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { teamId } = req.query as { teamId: string };
  const userId = (session.user as CustomUser).id;

  const userTeam = await prisma.userTeam.findUnique({
    where: {
      userId_teamId: {
        userId,
        teamId,
      },
    },
  });

  if (!userTeam) {
    return res.status(403).json({ error: "Access denied" });
  }

  const env = getSlackEnv();

  if (req.method === "GET") {
    try {
      const integration = await prisma.installedIntegration.findUnique({
        where: {
          teamId_integrationId: {
            teamId,
            integrationId: env.SLACK_INTEGRATION_ID,
          },
        },
        select: {
          credentials: true,
        },
      });

      if (!integration) {
        return res.status(404).json({ error: "Slack integration not found" });
      }

      const cacheKey = slackChannelsCacheKey(teamId);
      const skipCache = req.query.refresh === "true" || req.query.refresh === "1";

      if (!skipCache) {
        try {
          const cached = await redis.get<AvailableChannel[]>(cacheKey);
          if (cached) {
            return res.status(200).json({ channels: cached, cached: true });
          }
        } catch (cacheError) {
          console.error("Slack channels cache read failed:", cacheError);
        }
      }

      try {
        const slackClient = getSlackClient();
        const channels = await slackClient.getChannels(
          (integration.credentials as SlackCredential).accessToken,
        );

        const availableChannels: AvailableChannel[] = channels
          .filter((channel) => !channel.is_archived)
          .map((channel) => ({
            id: channel.id,
            name: channel.name,
            is_private: channel.is_private,
            is_member: channel.is_member || false,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        try {
          await redis.set(cacheKey, availableChannels, {
            ex: CHANNELS_CACHE_TTL_SECONDS,
          });
        } catch (cacheError) {
          console.error("Slack channels cache write failed:", cacheError);
        }

        return res.status(200).json({ channels: availableChannels });
      } catch (slackError) {
        if (slackError instanceof SlackRateLimitError) {
          return res.status(429).json({
            error:
              "Slack is rate limiting channel requests. Please wait a moment and refresh.",
          });
        }

        if (
          slackError instanceof Error &&
          slackError.message.includes("missing_scope")
        ) {
          return res.status(403).json({
            error:
              "Insufficient permissions. The Slack app needs channels:read permission.",
          });
        }

        if (
          slackError instanceof Error &&
          slackError.message.includes("invalid_auth")
        ) {
          return res.status(401).json({
            error:
              "Invalid Slack access token. Please reconnect your Slack integration.",
          });
        }
        console.error("Unexpected Slack error:", slackError);
        return res
          .status(502)
          .json({ error: "Failed to fetch Slack channels" });
      }
    } catch (error) {
      console.error("Error fetching Slack channels:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "PUT") {
    try {
      const updateChannelsSchema = z.object({
        enabledChannels: z.record(
          z.string(),
          z.object({
            id: z.string(),
            name: z.string(),
            enabled: z.boolean(),
            notificationTypes: z.array(z.string()),
          }),
        ),
      });
      const parsed = updateChannelsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid enabledChannels format" });
      }
      const { enabledChannels } = parsed.data;

      await prisma.installedIntegration.update({
        where: {
          teamId_integrationId: {
            teamId,
            integrationId: env.SLACK_INTEGRATION_ID,
          },
        },
        data: { configuration: { enabledChannels } },
      });

      return res.status(200).json({
        success: true,
        enabledChannels,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error updating Slack channels:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
