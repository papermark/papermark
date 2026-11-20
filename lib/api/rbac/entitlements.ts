import { Role } from "@prisma/client";

import prisma from "@/lib/prisma";

import { isDataroomScopedRole } from "./permissions";

/**
 * Dataroom-entitlement helpers ("which rooms"), complementing
 * {@link getPermissionsByRole} ("what verbs"). Only DATAROOM_MEMBER is scoped.
 */

/** Returns the dataroom ids a user is explicitly assigned to within a team. */
export async function getAllowedDataroomIds(
  userId: string,
  teamId: string,
): Promise<string[]> {
  const rows = await prisma.userDataroom.findMany({
    where: { userId, teamId },
    select: { dataroomId: true },
  });
  return rows.map((r) => r.dataroomId);
}

/** Whether `role` may access `dataroomId`. Scoped roles need it in `allowedIds`. */
export function canAccessDataroom(
  role: Role | string,
  allowedIds: string[],
  dataroomId: string,
): boolean {
  if (!isDataroomScopedRole(role)) return true;
  return allowedIds.includes(dataroomId);
}

/**
 * Whether `role` may perform room-manager actions on `dataroomId`: upload
 * (documents.write), links (links.read/write), and folders (datarooms.write).
 * NOTE: destructive ops (delete/freeze) stay ADMIN/MANAGER-only via `requiredRoles`.
 */
export function canManageDataroom(
  role: Role | string,
  allowedIds: string[],
  dataroomId: string,
): boolean {
  return canAccessDataroom(role, allowedIds, dataroomId);
}

/** Scoped roles may access a document only if it lives in an assigned dataroom. */
export async function assertDocumentAccess({
  role,
  userId,
  teamId,
  documentId,
  allowedIds,
}: {
  role: Role | string;
  userId: string;
  teamId: string;
  documentId: string;
  allowedIds?: string[];
}): Promise<boolean> {
  if (!isDataroomScopedRole(role)) return true;

  const ids = allowedIds ?? (await getAllowedDataroomIds(userId, teamId));
  if (ids.length === 0) return false;

  const match = await prisma.dataroomDocument.findFirst({
    where: {
      documentId,
      dataroomId: { in: ids },
    },
    select: { id: true },
  });
  return !!match;
}

/** Scoped roles may access a link only if it resolves to an assigned dataroom. */
export async function assertLinkAccess({
  role,
  userId,
  teamId,
  linkId,
  allowedIds,
}: {
  role: Role | string;
  userId: string;
  teamId: string;
  linkId: string;
  allowedIds?: string[];
}): Promise<boolean> {
  if (!isDataroomScopedRole(role)) return true;

  const ids = allowedIds ?? (await getAllowedDataroomIds(userId, teamId));
  if (ids.length === 0) return false;

  const link = await prisma.link.findUnique({
    where: { id: linkId },
    select: { dataroomId: true, documentId: true, teamId: true },
  });
  if (!link || link.teamId !== teamId) return false;

  if (link.dataroomId) {
    return ids.includes(link.dataroomId);
  }
  if (link.documentId) {
    return assertDocumentAccess({
      role,
      userId,
      teamId,
      documentId: link.documentId,
      allowedIds: ids,
    });
  }
  // Links with neither dataroom nor document are denied for scoped roles.
  return false;
}
