import { jackson, jacksonProduct, samlAudience } from "@/lib/jackson";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { isGenericDomain } from "@/lib/utils/email-domain";
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
    select: { id: true, plan: true, ssoEnabled: true, ssoEmailDomain: true, ssoEnforcedAt: true, slug: true },
  });

  if (!team) return null;

  return { userId, team, email: (session.user as CustomUser).email! };
}

// GET /api/teams/:teamId/saml — list SAML connections + issuer/acs info
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
      return NextResponse.json({
        connections: [],
        issuer: samlAudience,
        acs: `${process.env.NEXTAUTH_URL}/api/auth/saml/callback`,
        ssoEmailDomain: auth.team.ssoEmailDomain,
        ssoEnforcedAt: auth.team.ssoEnforcedAt,
        slug: auth.team.slug,
      });
    }

    const { apiController } = await jackson();

    const connections = await apiController.getConnections({
      tenant: teamId,
      product: jacksonProduct,
    });

    return NextResponse.json({
      connections,
      issuer: samlAudience,
      acs: `${process.env.NEXTAUTH_URL}/api/auth/saml/callback`,
      ssoEmailDomain: auth.team.ssoEmailDomain,
      ssoEnforcedAt: auth.team.ssoEnforcedAt,
      slug: auth.team.slug,
    });
  } catch (error: any) {
    if (isJacksonUnavailableError(error)) {
      console.warn("[SAML] Jackson unavailable, returning empty connections", error);
      return NextResponse.json({
        connections: [],
        issuer: samlAudience,
        acs: `${process.env.NEXTAUTH_URL}/api/auth/saml/callback`,
        ssoEmailDomain: auth.team.ssoEmailDomain,
        ssoEnforcedAt: auth.team.ssoEnforcedAt,
        slug: auth.team.slug,
      });
    }

    console.error("[SAML] Get connections error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/teams/:teamId/saml — create a new SAML connection
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
      { error: "SSO requires a Datarooms Premium plan" },
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
    const { apiController } = await jackson();
    const body = await req.json();
    const { rawMetadata, encodedRawMetadata, metadataUrl, domain } = body;

    if (!rawMetadata && !metadataUrl && !encodedRawMetadata) {
      return NextResponse.json(
        {
          error:
            "Either rawMetadata, encodedRawMetadata, or metadataUrl is required",
        },
        { status: 400 },
      );
    }

    // Normalize the explicit domain provided by the admin (if any)
    const explicitDomain = typeof domain === "string"
      ? domain.trim().toLowerCase().replace(/^@/, "")
      : undefined;

    // Validate explicit domain format if provided
    if (explicitDomain && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(explicitDomain)) {
      return NextResponse.json(
        { error: "Invalid domain format. Please provide a valid domain (e.g., example.com)." },
        { status: 400 },
      );
    }

    // Reject public / free email provider domains – SSO should only be
    // configured for organisation-owned domains.
    if (explicitDomain && isGenericDomain(explicitDomain)) {
      return NextResponse.json(
        {
          error:
            "Public email domains (e.g., gmail.com, outlook.com) cannot be used for SSO. Please provide your organization's domain.",
        },
        { status: 400 },
      );
    }

    const connection = await apiController.createSAMLConnection({
      defaultRedirectUrl: `${process.env.NEXTAUTH_URL}/auth/saml`,
      redirectUrl: process.env.NEXTAUTH_URL as string,
      tenant: teamId,
      product: jacksonProduct,
      rawMetadata: rawMetadata || undefined,
      encodedRawMetadata: encodedRawMetadata || undefined,
      metadataUrl: metadataUrl || undefined,
    });

    // Attempt to extract a domain hint from the IdP metadata returned by the
    // SAML connection.  Standard IdP entity IDs / SSO URLs sometimes contain
    // the organisation's own domain (e.g. for self-hosted IdPs).  We use this
    // as an additional validation signal – if the admin supplied a domain we
    // check it is consistent; if not, we fall back to the metadata hint only
    // when it looks like a real organisation domain (not a generic IdP host).
    let metadataDomain: string | undefined;
    try {
      const idpMeta = (connection as any)?.idpMetadata;
      const candidateUrls: string[] = [
        idpMeta?.entityID,
        idpMeta?.sso?.postUrl,
        idpMeta?.sso?.redirectUrl,
      ].filter(Boolean);

      const genericIdpHosts = new Set([
        "accounts.google.com",
        "login.microsoftonline.com",
        "sts.windows.net",
        "idp.ssocircle.com",
        "www.okta.com",
        "dev.okta.com",
        "auth0.com",
        "onelogin.com",
        "pingone.com",
      ]);

      for (const raw of candidateUrls) {
        try {
          const host = new URL(raw).hostname.toLowerCase();
          // Skip well-known generic IdP hosts and public email domains
          if (
            [...genericIdpHosts].some((g) => host === g || host.endsWith(`.${g}`)) ||
            isGenericDomain(host)
          ) {
            continue;
          }
          // Must have at least two labels (e.g. "company.com")
          if (host.split(".").length >= 2) {
            metadataDomain = host;
            break;
          }
        } catch {
          // not a valid URL – skip
        }
      }
    } catch {
      // metadata extraction is best-effort
    }

    // Determine the validated domain to persist:
    //  1. Prefer the explicitly admin-provided domain.
    //  2. Fall back to a domain extracted from metadata (if non-generic).
    //  3. If neither is available, do NOT store a domain.
    const validatedDomain = explicitDomain || metadataDomain || undefined;

    // Only persist ssoEmailDomain when we have a validated value
    if (validatedDomain) {
      await prisma.team.update({
        where: { id: teamId },
        data: {
          ssoEmailDomain: validatedDomain,
        },
      });
    }

    return NextResponse.json(connection, { status: 201 });
  } catch (error: any) {
    console.error("[SAML] Create connection error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}

// PATCH /api/teams/:teamId/saml — update SSO enforcement settings
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const auth = await getAuthenticatedAdmin(teamId);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { enforced } = body;

    if (typeof enforced !== "boolean") {
      return NextResponse.json(
        { error: "'enforced' must be a boolean" },
        { status: 400 },
      );
    }

    // Can only enforce if there's an ssoEmailDomain set (which is set when SAML is configured)
    if (enforced && !auth.team.ssoEmailDomain) {
      return NextResponse.json(
        {
          error:
            "Cannot enforce SSO without a configured email domain. Please configure SAML first.",
        },
        { status: 400 },
      );
    }

    // Verify there are active SAML connections before enforcing
    if (enforced) {
      const { apiController } = await jackson();
      const connections = await apiController.getConnections({
        tenant: teamId,
        product: jacksonProduct,
      });

      if (!connections || connections.length === 0) {
        return NextResponse.json(
          {
            error:
              "Cannot enforce SSO without an active SAML connection. Please configure SAML first.",
          },
          { status: 400 },
        );
      }
    }

    const now = enforced ? new Date() : null;

    await prisma.team.update({
      where: { id: teamId },
      data: {
        ssoEnforcedAt: now,
      },
    });

    return NextResponse.json({
      enforced,
      ssoEnforcedAt: now?.toISOString() ?? null,
    });
  } catch (error: any) {
    console.error("[SAML] Update enforcement error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE /api/teams/:teamId/saml — remove a SAML connection
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
    const { apiController } = await jackson();
    const body = await req.json();
    const { clientID, clientSecret } = body;

    if (!clientID || !clientSecret) {
      return NextResponse.json(
        { error: "clientID and clientSecret are required" },
        { status: 400 },
      );
    }

    // Ownership check: verify the connection belongs to this team before deleting
    const existingConnections = await apiController.getConnections({
      clientID,
    });

    const connection = Array.isArray(existingConnections)
      ? existingConnections[0]
      : existingConnections;

    if (!connection) {
      return NextResponse.json(
        { error: "SAML connection not found" },
        { status: 404 },
      );
    }

    if (connection.tenant !== teamId) {
      return NextResponse.json(
        { error: "You do not have permission to delete this connection" },
        { status: 403 },
      );
    }

    await apiController.deleteConnections({
      clientID,
      clientSecret,
      tenant: teamId,
      product: jacksonProduct,
    });

    // Check if there are remaining connections
    const remaining = await apiController.getConnections({
      tenant: teamId,
      product: jacksonProduct,
    });

    if (!remaining || (Array.isArray(remaining) && remaining.length === 0)) {
      // No more connections — clear SSO domain and enforcement
      await prisma.team.update({
        where: { id: teamId },
        data: {
          ssoEmailDomain: null,
          ssoEnforcedAt: null,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[SAML] Delete connection error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}
