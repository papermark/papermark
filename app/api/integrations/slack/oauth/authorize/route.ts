import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth/auth-options";
import { getServerSession } from "next-auth/next";
import { z } from "zod";

import { getSlackInstallationUrl } from "@/lib/integrations/slack/install";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { getSearchParams } from "@/lib/utils/get-search-params";

const oAuthAuthorizeSchema = z.object({
  teamId: z.string().cuid(),
});

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { teamId } = oAuthAuthorizeSchema.parse(getSearchParams(req.url));
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
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const oauthUrl = await getSlackInstallationUrl(teamId);

    return NextResponse.json({
      oauthUrl,
    });
  } catch (error) {
    console.error("Slack OAuth authorization error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
