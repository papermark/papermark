import { Role } from "@prisma/client";

/**
 * Granular permission verbs used by the session `withTeam` wrapper. A role maps
 * to a set of these via {@link getPermissionsByRole}; routes declare the verb(s)
 * they require. This is the "what verbs" layer (the "which rooms" layer is the
 * UserDataroom entitlement check, which a role alone cannot encode).
 */
export type PermissionAction =
  | "datarooms.read"
  | "datarooms.write"
  // Read access to the team-wide "All Documents" list/search.
  | "documents.read"
  // Create/upload documents and attach them to datarooms.
  | "documents.write"
  | "links.read"
  | "links.write"
  // Read analytics scoped to an individual dataroom/document.
  | "analytics.read"
  // Read team-wide analytics (the global dashboard).
  | "analytics.team"
  | "team.read"
  | "team.write"
  // Manage members (invite/remove/change role).
  | "members.write"
  | "tokens.write"
  | "webhooks.write"
  | "domains.write"
  | "branding.read"
  | "branding.write"
  // SAML / SSO configuration (admin only).
  | "sso.write";

const ALL_PERMISSIONS: PermissionAction[] = [
  "datarooms.read",
  "datarooms.write",
  "documents.read",
  "documents.write",
  "links.read",
  "links.write",
  "analytics.read",
  "analytics.team",
  "team.read",
  "team.write",
  "members.write",
  "tokens.write",
  "webhooks.write",
  "domains.write",
  "branding.read",
  "branding.write",
  "sso.write",
];

// MANAGER gets everything except the admin-only structural operations.
const MANAGER_DENIED: PermissionAction[] = ["members.write", "sso.write"];

// MEMBER keeps today's broad behaviour: team read/write minus the
// admin/manager-only structural operations.
const MEMBER_DENIED: PermissionAction[] = [
  "members.write",
  "tokens.write",
  "webhooks.write",
  "domains.write",
  "sso.write",
];

// The minimal verb set a DATAROOM_MEMBER holds. Notably this excludes
// `documents.read` (the team-wide All Documents list), `analytics.team`, and
// every `team.*`/`members.write` verb. The per-room entitlement check (see
// `lib/api/rbac/entitlements.ts`) further restricts which datarooms these
// verbs apply to.
const DATAROOM_MEMBER_PERMISSIONS: PermissionAction[] = [
  "datarooms.read",
  "datarooms.write",
  "documents.write",
  "links.read",
  "links.write",
  "analytics.read",
  // Read team brands when picking one for an assigned room or link.
  "branding.read",
];

/**
 * Returns the set of permission verbs granted to a role. The set is the single
 * source of truth for "what verbs" a role can perform, mirroring Dub's
 * `getPermissionsByRole`.
 */
export function getPermissionsByRole(
  role: Role | string,
): Set<PermissionAction> {
  switch (role) {
    case "ADMIN":
      return new Set(ALL_PERMISSIONS);
    case "MANAGER":
      return new Set(
        ALL_PERMISSIONS.filter((p) => !MANAGER_DENIED.includes(p)),
      );
    case "MEMBER":
      return new Set(ALL_PERMISSIONS.filter((p) => !MEMBER_DENIED.includes(p)));
    case "DATAROOM_MEMBER":
      return new Set(DATAROOM_MEMBER_PERMISSIONS);
    default:
      // Unknown / future roles are denied everything by default.
      return new Set<PermissionAction>();
  }
}

/**
 * True when `role` holds every required permission verb.
 */
export function hasAllPermissions(
  role: Role | string,
  required: PermissionAction[],
): boolean {
  if (required.length === 0) return true;
  const granted = getPermissionsByRole(role);
  return required.every((p) => granted.has(p));
}

/** True for the dataroom-scoped role, which needs per-room entitlement checks. */
export function isDataroomScopedRole(role: Role | string): boolean {
  return role === "DATAROOM_MEMBER";
}
