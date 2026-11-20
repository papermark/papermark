import { RootItemAccess } from "@prisma/client";

/**
 * Maps a dataroom's root-item access setting to the ACL flags written for a
 * newly created root-level item under INHERIT_FROM_PARENT. Returns `null` for
 * HIDDEN, meaning no access-control row should be created at all (absence of
 * a row is how "not visible" is represented for group-restricted links).
 */
export function resolveRootItemAccessFlags(
  access: RootItemAccess,
): { canView: boolean; canDownload: boolean } | null {
  switch (access) {
    case RootItemAccess.VIEW_ONLY:
      return { canView: true, canDownload: false };
    case RootItemAccess.VIEW_AND_DOWNLOAD:
      return { canView: true, canDownload: true };
    case RootItemAccess.HIDDEN:
      return null;
    default: {
      const _exhaustive: never = access;
      throw new Error(`Unhandled root item access: ${_exhaustive}`);
    }
  }
}
