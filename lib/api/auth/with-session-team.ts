import { NextApiRequest, NextApiResponse } from "next";
import { NextRequest, NextResponse } from "next/server";

import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth/auth-options";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

import {
  type PermissionAction,
  getPermissionsByRole,
  isDataroomScopedRole,
} from "@/lib/api/rbac/permissions";
import {
  canAccessDataroom,
  getAllowedDataroomIds,
} from "@/lib/api/rbac/entitlements";

/**
 * Unified session-based `withTeam` wrapper for internal (NextAuth) routes.
 *
 * It centralises the membership/role logic that today is copy-pasted as inline
 * `prisma.userTeam.findUnique` checks across every team route, and adds RBAC
 * permissions plus a per-room entitlement check for the dataroom-scoped role.
 *
 * Crucially it is **default-deny for DATAROOM_MEMBER**: a scoped member is
 * rejected on any wrapped route unless the route explicitly opts in by
 * declaring a `requiredPermissions` set the role holds (and, when a
 * `dataroomParam`/`resolveDataroomId` is configured, passes the room
 * entitlement). This makes "don't leak to scoped members" auditable instead of
 * relying on per-handler guards.
 */

export interface SessionTeamMembership {
  role: Role;
  status: string;
  blockedAt: Date | null;
}

export interface SessionTeamContext {
  userId: string;
  teamId: string;
  membership: SessionTeamMembership;
  role: Role;
  permissions: Set<PermissionAction>;
  /** Dataroom ids the scoped member is assigned to (empty for non-scoped roles). */
  allowedDataroomIds: string[];
  /** The resolved dataroom id, when a `dataroomParam`/resolver was configured. */
  dataroomId?: string;
  team: { id: string; plan: string };
}

export interface WithSessionTeamOptions {
  /** Permission verbs the caller's role must hold. Required for scoped members to opt in. */
  requiredPermissions?: PermissionAction[];
  /** Restrict to an explicit set of roles (independent of permissions). */
  requiredRoles?: Role[];
  /** Predicate over the team plan string; return false to 403. */
  requiredPlan?: (plan: string) => boolean;
  /**
   * Name of the route param/query key holding the dataroom id. When set and the
   * caller is a scoped member, the room entitlement is enforced.
   */
  dataroomParam?: string;
  /**
   * Custom resolver for the dataroom id (e.g. read from the request body). Takes
   * precedence over `dataroomParam`. Return null/undefined to skip the room
   * entitlement check (the route is responsible for its own scoping in that case).
   */
  resolveDataroomId?: (args: {
    params: Record<string, string | string[] | undefined>;
    req: NextRequest | NextApiRequest;
  }) => Promise<string | null | undefined> | string | null | undefined;
  /**
   * Custom resolver for the team id when it is not in the route params
   * (e.g. sent in the request body). Used only when `params.teamId` is absent.
   */
  resolveTeamId?: (args: {
    params: Record<string, string | string[] | undefined>;
    req: NextRequest | NextApiRequest;
  }) => Promise<string | null | undefined> | string | null | undefined;
}

type AuthError = { status: number; message: string };

function isAuthError(x: unknown): x is AuthError {
  return (
    typeof x === "object" &&
    x !== null &&
    "status" in x &&
    "message" in x &&
    typeof (x as AuthError).status === "number"
  );
}

function firstString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v ?? undefined;
}

/**
 * Shared core: given a resolved session + teamId + the request params/body
 * accessors, run every gate and either resolve a {@link SessionTeamContext} or
 * an {@link AuthError}.
 */
async function resolveSessionTeam({
  session,
  teamId: teamIdInput,
  params,
  req,
  opts,
}: {
  session: { user?: unknown } | null;
  teamId: string | undefined;
  params: Record<string, string | string[] | undefined>;
  req: NextRequest | NextApiRequest;
  opts: WithSessionTeamOptions;
}): Promise<SessionTeamContext | AuthError> {
  if (!session || !session.user) {
    return { status: 401, message: "Unauthorized" };
  }

  let teamId = teamIdInput;
  if (!teamId && opts.resolveTeamId) {
    const resolved = await opts.resolveTeamId({ params, req });
    if (typeof resolved === "string" && resolved.length > 0) {
      teamId = resolved;
    }
  }

  if (!teamId) {
    return { status: 400, message: "Missing teamId" };
  }

  const userId = (session.user as CustomUser).id;

  const membership = await prisma.userTeam.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: {
      role: true,
      status: true,
      blockedAt: true,
      team: { select: { id: true, plan: true } },
    },
  });

  if (!membership) {
    return { status: 401, message: "Unauthorized" };
  }
  if (membership.status !== "ACTIVE" || membership.blockedAt) {
    return {
      status: 403,
      message: "Your access to this team is not active.",
    };
  }

  const role = membership.role;
  const permissions = getPermissionsByRole(role);

  // Role gate (independent of permissions).
  if (opts.requiredRoles && !opts.requiredRoles.includes(role)) {
    return {
      status: 403,
      message: "You are not permitted to perform this action.",
    };
  }

  // Permission gate.
  const required = opts.requiredPermissions ?? [];
  if (!required.every((p) => permissions.has(p))) {
    return {
      status: 403,
      message: "You do not have permission to perform this action.",
    };
  }

  // Default-deny for the scoped role: it must opt in via at least one declared
  // permission. A route with no `requiredPermissions` never admits a scoped
  // member, even if it forgot a more specific guard.
  const scoped = isDataroomScopedRole(role);
  if (scoped && required.length === 0) {
    return {
      status: 403,
      message: "You do not have permission to perform this action.",
    };
  }

  // Plan gate.
  if (opts.requiredPlan && !opts.requiredPlan(membership.team.plan)) {
    return {
      status: 403,
      message: "This feature requires a different plan.",
    };
  }

  // Per-room entitlement (only computed/enforced for the scoped role).
  let allowedDataroomIds: string[] = [];
  let dataroomId: string | undefined;

  if (scoped) {
    allowedDataroomIds = await getAllowedDataroomIds(userId, teamId);

    let resolved: string | null | undefined;
    if (opts.resolveDataroomId) {
      resolved = await opts.resolveDataroomId({ params, req });
    } else if (opts.dataroomParam) {
      resolved =
        firstString(params[opts.dataroomParam]) ??
        firstString(
          (req as NextApiRequest).query?.[opts.dataroomParam] as
            | string
            | string[]
            | undefined,
        );
    }

    if (resolved) {
      dataroomId = resolved;
      if (!canAccessDataroom(role, allowedDataroomIds, resolved)) {
        return {
          status: 403,
          message: "You do not have access to this data room.",
        };
      }
    }
  }

  return {
    userId,
    teamId,
    membership: {
      role: membership.role,
      status: membership.status,
      blockedAt: membership.blockedAt,
    },
    role,
    permissions,
    allowedDataroomIds,
    dataroomId,
    team: membership.team,
  };
}

/* ------------------------------------------------------------------ */
/* App Router variant                                                 */
/* ------------------------------------------------------------------ */

export interface AppRouterTeamContext extends SessionTeamContext {
  req: NextRequest;
  params: Record<string, string>;
}

export type AppRouterTeamHandler = (
  ctx: AppRouterTeamContext,
) => Promise<NextResponse> | NextResponse;

export function withTeam(
  handler: AppRouterTeamHandler,
  opts: WithSessionTeamOptions = {},
) {
  return async (
    req: NextRequest,
    context: {
      params: Promise<Record<string, string>> | Record<string, string>;
    },
  ): Promise<NextResponse> => {
    const params =
      context?.params && typeof (context.params as any).then === "function"
        ? await (context.params as Promise<Record<string, string>>)
        : ((context?.params as Record<string, string>) ?? {});

    const session = await getServerSession(authOptions);
    const result = await resolveSessionTeam({
      session,
      teamId: params.teamId,
      params,
      req,
      opts,
    });

    if (isAuthError(result)) {
      return NextResponse.json(
        { error: result.message },
        { status: result.status },
      );
    }

    return handler({ ...result, req, params });
  };
}

/* ------------------------------------------------------------------ */
/* Pages Router variant                                               */
/* ------------------------------------------------------------------ */

export interface PagesRouterTeamContext extends SessionTeamContext {
  req: NextApiRequest;
  res: NextApiResponse;
}

export type PagesRouterTeamHandler = (
  ctx: PagesRouterTeamContext,
) => unknown | Promise<unknown>;

export function withTeamApi(
  handler: PagesRouterTeamHandler,
  opts: WithSessionTeamOptions = {},
) {
  return async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
    const session = await getServerSession(req, res, authOptions);
    const teamId = firstString(req.query.teamId);

    const result = await resolveSessionTeam({
      session,
      teamId,
      params: req.query,
      req,
      opts,
    });

    if (isAuthError(result)) {
      res.status(result.status).json({ error: result.message });
      return;
    }

    await handler({ ...result, req, res });
  };
}
