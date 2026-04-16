import { jackson, jacksonProduct } from "@/lib/jackson";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth/auth-options";

const SSO_ELIGIBLE_PLANS = ["datarooms-premium", "datarooms-premium+old", "datarooms-unlimited", "datarooms-unlimited+old"];

function isJacksonUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("error connecting to engine") ||
    message.includes("Missing Jackson DB URL") ||
    message.includes("ENOENT: no such file or directory, open 'system'")
  );
}

async function getAuthenticatedAdmin(teamId: string) {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const userId = (session.user as CustomUser).id;

  const teamAccess = await prisma.userTeam.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { role: true },
  });

  if (!teamAccess || teamAccess.role !== "ADMIN") return null;

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, plan: true, ssoEnabled: true },
  });

  if (!team) return null;

  return { userId, team };
}

// GET /api/teams/:teamId/directory-sync — list SCIM directories
export async function GET(
  req: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const auth = await getAuthenticatedAdmin(teamId);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (!auth.team.ssoEnabled || !SSO_ELIGIBLE_PLANS.includes(auth.team.plan)) {
      return NextResponse.json({ directories: [] });
    }

    const { directorySyncController } = await jackson();

    const { data, error } =
      await directorySyncController.directories.getByTenantAndProduct(
        teamId,
        jacksonProduct,
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ directories: data });
  } catch (error: any) {
    if (isJacksonUnavailableError(error)) {
      console.warn("[SCIM] Jackson unavailable, returning empty directories", error);
      return NextResponse.json({ directories: [] });
    }

    console.error("[SCIM] Get directories error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/teams/:teamId/directory-sync — create a SCIM directory connection
export async function POST(
  req: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const auth = await getAuthenticatedAdmin(teamId);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Plan gate
  if (!SSO_ELIGIBLE_PLANS.includes(auth.team.plan)) {
    return NextResponse.json(
      { error: "SCIM Directory Sync requires a Datarooms Premium plan" },
      { status: 403 },
    );
  }

  // Feature flag gate
  if (!auth.team.ssoEnabled) {
    return NextResponse.json(
      { error: "SSO is not enabled for this team" },
      { status: 403 },
    );
  }

  try {
    const { directorySyncController } = await jackson();
    const body = await req.json();
    const { name, type, currentDirectoryId } = body;

    // Create the new directory first; only delete the old one on success
    const result = await directorySyncController.directories.create({
      tenant: teamId,
      product: jacksonProduct,
      name: name || "Papermark SCIM Directory",
      type: type || "azure-scim-v2",
    });

    if (result.error) {
      return NextResponse.json(
        { error: result.error.message },
        { status: 400 },
      );
    }

    // If replacing an existing directory, delete the old one after successful create
    if (currentDirectoryId) {
      await directorySyncController.directories.delete(currentDirectoryId);
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error("[SCIM] Create directory error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE /api/teams/:teamId/directory-sync — delete a SCIM directory
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const auth = await getAuthenticatedAdmin(teamId);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { directorySyncController } = await jackson();
    const body = await req.json();
    const { directoryId } = body;

    if (!directoryId) {
      return NextResponse.json(
        { error: "directoryId is required" },
        { status: 400 },
      );
    }

    const { error } =
      await directorySyncController.directories.delete(directoryId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[SCIM] Delete directory error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}
