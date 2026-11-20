import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth/auth-options";
import { Team } from "@prisma/client";
import { getServerSession } from "next-auth";
import z from "zod";

import { installIntegration } from "@/lib/integrations/install";
import { getSlackEnv } from "@/lib/integrations/slack/env";
import { SlackCredential } from "@/lib/integrations/slack/types";
import { encryptSlackToken } from "@/lib/integrations/slack/utils";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { CustomUser } from "@/lib/types";
import { getSearchParams } from "@/lib/utils/get-search-params";

export const dynamic = "force-dynamic";

const oAuthCallbackSchema = z.object({
  code: z.string(),
  state: z.string(),
});

export const GET = async (req: Request) => {
  const env = getSlackEnv();

  let team: Pick<Team, "id" | "plan"> | null = null;

  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as CustomUser).id;

    const { code, state } = oAuthCallbackSchema.parse(getSearchParams(req.url));

    // Find workspace that initiated the Stripe app install
    const stateKey = `slack:install:state:${state}`;
    const teamId = await redis.get<string>(stateKey);

    if (!teamId) {
      return NextResponse.json({ error: "Invalid state" }, { status: 400 });
    }
    await redis.del(stateKey);

    team = await prisma.team.findUniqueOrThrow({
      where: {
        id: teamId,
        users: {
          some: {
            userId,
          },
        },
      },
      select: {
        id: true,
        plan: true,
      },
    });

    if (!team) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const body = new URLSearchParams({
      code,
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/integrations/slack/oauth/callback`,
    });
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 10000);
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      signal: ac.signal,
    }).finally(() => clearTimeout(to));

    const data = await response.json();
    if (!data?.ok) {
      return NextResponse.json(
        { error: `Slack OAuth error: ${data?.error || "unknown"}` },
        { status: 400 },
      );
    }

    const credentials: SlackCredential = {
      appId: data.app_id,
      botUserId: data.bot_user_id,
      scope: data.scope,
      accessToken: encryptSlackToken(data.access_token),
      tokenType: data.token_type,
      authUser: data.authed_user,
      team: data.team,
    };

    await installIntegration({
      integrationId: env.SLACK_INTEGRATION_ID,
      userId,
      teamId,
      credentials,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  redirect(`/settings/slack?success=true`);
};
