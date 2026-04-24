import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";
import { z } from "zod";

import { getSlackEnv } from "@/lib/integrations/slack/env";
import {
  SlackCredential,
  SlackCredentialPublic,
} from "@/lib/integrations/slack/types";
import { uninstallSlackIntegration } from "@/lib/integrations/slack/uninstall";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

const channelConfigSchema = z.object({
  enabled: z.boolean(),
  notificationTypes: z
    .array(z.enum(["document_view", "document_download", "dataroom_access"]))
    .default([]),
  name: z.string().optional(),
  id: z.string().optional(),
});
const slackIntegrationUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  enabledChannels: z.record(z.string(), channelConfigSchema).optional(),
});

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

  switch (req.method) {
    case "GET":
      return handleGet(req, res, teamId);
    case "PUT":
      return handleUpdate(req, res, teamId);
    case "DELETE":
      return handleDelete(req, res, teamId);
    default:
      return res.status(405).json({ error: "Method not allowed" });
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  teamId: string,
) {
  const env = getSlackEnv();

  try {
    const integrationFullData = await prisma.installedIntegration.findUnique({
      where: {
        teamId_integrationId: {
          teamId,
          integrationId: env.SLACK_INTEGRATION_ID,
        },
      },
      select: {
        id: true,
        credentials: true,
        configuration: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!integrationFullData) {
      return res.status(404).json({ error: "Slack integration not found" });
    }

    const integration = {
      ...integrationFullData,
      credentials: {
        team: (integrationFullData.credentials as SlackCredential)?.team,
      },
    };

    return res.status(200).json(integration);
  } catch (error) {
    console.error("Error fetching Slack integration:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function handleUpdate(
  req: NextApiRequest,
  res: NextApiResponse,
  teamId: string,
) {
  const env = getSlackEnv();
  try {
    const validationResult = slackIntegrationUpdateSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: "Invalid request payload",
        details: validationResult.error.errors,
      });
    }

    const { enabled, enabledChannels } = validationResult.data;

    if (enabledChannels && Object.keys(validationResult.data).length === 1) {
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
    }

    const updateData: any = {};
    if (enabled !== undefined) updateData.enabled = enabled;
    if (enabledChannels) updateData.configuration = { enabledChannels };

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const updatedIntegrationData = await prisma.installedIntegration.update({
      where: {
        teamId_integrationId: {
          teamId,
          integrationId: env.SLACK_INTEGRATION_ID,
        },
      },
      data: updateData,
      select: {
        id: true,
        credentials: true,
        configuration: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const updatedIntegration = {
      ...updatedIntegrationData,
      credentials: {
        team: (updatedIntegrationData.credentials as SlackCredential)?.team,
      },
    };

    return res.status(200).json(updatedIntegration);
  } catch (error) {
    console.error("Error updating Slack integration:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function handleDelete(
  req: NextApiRequest,
  res: NextApiResponse,
  teamId: string,
) {
  const env = getSlackEnv();
  try {
    const integration = await prisma.installedIntegration.findUnique({
      where: {
        teamId_integrationId: {
          teamId,
          integrationId: env.SLACK_INTEGRATION_ID,
        },
      },
    });

    if (!integration) {
      return res.status(404).json({ error: "Slack integration not found" });
    }

    // Best-effort remote uninstall. If the stored token is already invalid /
    // revoked (e.g. after rotating SLACK_CLIENT_SECRET or reinstalling the app
    // in Slack), we still want the user to be able to disconnect locally so
    // they can reconnect with fresh credentials.
    const uninstallResult = await uninstallSlackIntegration({
      installation: integration,
    });

    if (!uninstallResult.ok && !uninstallResult.recoverable) {
      return res.status(502).json({
        error:
          "Failed to uninstall Slack app from the workspace. Please try again.",
        slackError: uninstallResult.error,
      });
    }

    await prisma.installedIntegration.delete({
      where: {
        teamId_integrationId: {
          teamId,
          integrationId: env.SLACK_INTEGRATION_ID,
        },
      },
    });

    if (!uninstallResult.ok) {
      return res.status(200).json({
        message:
          "Slack integration disconnected locally; remote uninstall was not performed.",
        slackError: uninstallResult.error,
      });
    }

    return res
      .status(200)
      .json({ message: "Slack integration deleted successfully" });
  } catch (error) {
    console.error("Error deleting Slack integration:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
