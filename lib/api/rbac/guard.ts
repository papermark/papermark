import { NextApiResponse } from "next";
import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";

import {
  assertDocumentAccess,
  assertLinkAccess,
  canAccessDataroom,
} from "./entitlements";
import { isDataroomScopedRole } from "./permissions";

/**
 * App-router variant of the team-level scope check. Billing routes are
 * team-level actions, so a dataroom-scoped member is denied outright. Returns a
 * 403 `NextResponse` when denied, or `null` when access is allowed.
 */
export async function denyDataroomScopedMember({
  userId,
  teamId,
  role,
}: {
  userId: string;
  teamId: string;
  role?: string;
}): Promise<NextResponse | null> {
  let resolvedRole = role;
  if (resolvedRole === undefined) {
    const membership = await prisma.userTeam.findUnique({
      where: { userId_teamId: { userId, teamId } },
      select: { role: true },
    });
    resolvedRole = membership?.role;
  }

  if (!resolvedRole || !isDataroomScopedRole(resolvedRole)) {
    return null;
  }

  return NextResponse.json(
    { error: "You do not have permission to perform this action." },
    { status: 403 },
  );
}

/**
 * Lightweight inline guard for team routes that have NOT yet been migrated to
 * the `withTeam` session wrapper. It enforces two invariants for the
 * dataroom-scoped role on top of a route's existing membership check:
 *
 *  1. If `dataroomId` is provided, a scoped member must be assigned to that
 *     room (closes cross-room IDOR for assigned-vs-unassigned rooms).
 *  2. If `dataroomId` is NOT provided (a team-level route), a scoped member is
 *     denied outright (default-deny — these routes are not part of the scoped
 *     surface).
 *
 * Returns `true` if the request was denied (and a response was sent); the
 * caller should `return` immediately. Returns `false` when access is allowed.
 *
 * Non-scoped roles (ADMIN/MANAGER/MEMBER) are never affected by this guard.
 */
export async function enforceDataroomMemberScope({
  userId,
  teamId,
  dataroomId,
  res,
  role,
}: {
  userId: string;
  teamId: string;
  dataroomId?: string | null;
  res: NextApiResponse;
  /** Optional pre-loaded role to avoid an extra query. */
  role?: string;
}): Promise<boolean> {
  let resolvedRole = role;
  if (resolvedRole === undefined) {
    const membership = await prisma.userTeam.findUnique({
      where: { userId_teamId: { userId, teamId } },
      select: { role: true },
    });
    resolvedRole = membership?.role;
  }

  if (!resolvedRole || !isDataroomScopedRole(resolvedRole)) {
    return false;
  }

  if (!dataroomId) {
    res
      .status(403)
      .json({ error: "You do not have permission to perform this action." });
    return true;
  }

  const allowed = await prisma.userDataroom.findUnique({
    where: { userId_dataroomId: { userId, dataroomId } },
    select: { dataroomId: true },
  });

  if (!canAccessDataroom(resolvedRole, allowed ? [dataroomId] : [], dataroomId)) {
    res
      .status(403)
      .json({ error: "You do not have access to this data room." });
    return true;
  }

  return false;
}

/**
 * Inline link guard. Denies a scoped member that tries to act on a link which
 * resolves to a dataroom/document outside their assigned rooms. Returns `true`
 * (and sends a 403) when denied. Non-scoped roles always pass.
 */
export async function enforceLinkMemberScope({
  userId,
  teamId,
  linkId,
  res,
  role,
}: {
  userId: string;
  teamId: string;
  linkId: string;
  res: NextApiResponse;
  role?: string;
}): Promise<boolean> {
  let resolvedRole = role;
  if (resolvedRole === undefined) {
    const membership = await prisma.userTeam.findUnique({
      where: { userId_teamId: { userId, teamId } },
      select: { role: true },
    });
    resolvedRole = membership?.role;
  }

  if (!resolvedRole || !isDataroomScopedRole(resolvedRole)) {
    return false;
  }

  const allowed = await assertLinkAccess({
    role: resolvedRole,
    userId,
    teamId,
    linkId,
  });

  if (!allowed) {
    res.status(403).json({ error: "You do not have access to this link." });
    return true;
  }

  return false;
}

/**
 * Inline document guard. Denies a scoped member that tries to act on a document
 * which does not live in any of their assigned rooms. Returns `true` (and sends
 * a 403) when denied. Non-scoped roles always pass.
 */
export async function enforceDocumentMemberScope({
  userId,
  teamId,
  documentId,
  res,
  role,
}: {
  userId: string;
  teamId: string;
  documentId: string;
  res: NextApiResponse;
  role?: string;
}): Promise<boolean> {
  let resolvedRole = role;
  if (resolvedRole === undefined) {
    const membership = await prisma.userTeam.findUnique({
      where: { userId_teamId: { userId, teamId } },
      select: { role: true },
    });
    resolvedRole = membership?.role;
  }

  if (!resolvedRole || !isDataroomScopedRole(resolvedRole)) {
    return false;
  }

  const allowed = await assertDocumentAccess({
    role: resolvedRole,
    userId,
    teamId,
    documentId,
  });

  if (!allowed) {
    res.status(403).json({ error: "You do not have access to this document." });
    return true;
  }

  return false;
}
