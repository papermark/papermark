import { ItemType } from "@prisma/client";

/**
 * Pure helpers for computing dataroom permission diffs from the in-memory tree
 * shown in the group-permissions UI. Extracted from
 * `components/datarooms/groups/group-permissions.tsx` so the parent-cascade
 * behaviour can be unit tested without React.
 *
 * The server (`/api/.../permissions`) still re-derives ancestors via a
 * recursive CTE as a safety net, but these helpers are what produce the
 * payload from a user toggle and what backs the optimistic UI.
 */

export const VIRTUAL_ROOT_ID = "__dataroom_root__";

export type TreeNodePermissions = {
  view: boolean;
  download: boolean;
};

export type TreeNode = {
  id: string;
  itemType: ItemType;
  permissions: TreeNodePermissions;
  subItems?: TreeNode[];
};

export type PermissionChange = {
  view: boolean;
  download: boolean;
  itemType: ItemType;
};

export type PermissionChanges = Record<string, PermissionChange>;

/**
 * Enforce the "download requires view" invariant. Mirrors the behaviour the
 * UI relied on inline before extraction.
 */
export function normalizePermissions(input: {
  view: boolean;
  download: boolean;
}): TreeNodePermissions {
  if (!input.view) {
    return { view: false, download: false };
  }
  return { view: true, download: input.download };
}

export function findItemAndParents(
  items: TreeNode[],
  targetId: string,
  parents: TreeNode[] = [],
): { item: TreeNode; parents: TreeNode[] } | null {
  for (const item of items) {
    if (item.id === targetId) {
      return { item, parents };
    }
    if (item.subItems) {
      const result = findItemAndParents(item.subItems, targetId, [
        ...parents,
        item,
      ]);
      if (result) return result;
    }
  }
  return null;
}

/**
 * Build the change set produced when the user toggles permissions on a single
 * item (folder or document). Cascades:
 *   - the item itself
 *   - all descendants (set to the new permission)
 *   - all ancestors:
 *       - if turning view/download ON: ancestors are forced visible (download
 *         only forced ON if the user explicitly turned download ON)
 *       - if turning view OFF: ancestors are recomputed from their *remaining*
 *         siblings (the toggled item is treated as if it already has the new
 *         permission). View AND download both get recomputed from siblings.
 *       - if turning download OFF while view stays on: ancestors keep their
 *         view=true but their download is recomputed from remaining
 *         siblings, so a folder whose only downloadable descendant just went
 *         away no longer has a stale `canDownload=true` row.
 *
 * The virtual `__dataroom_root__` node is never written to the DB.
 */
export function collectChangesForItem(
  item: TreeNode,
  parents: TreeNode[],
  rawPermissions: { view: boolean; download: boolean },
): PermissionChanges {
  const updated = normalizePermissions(rawPermissions);
  const changes: PermissionChanges = {};

  if (item.id !== VIRTUAL_ROOT_ID) {
    changes[item.id] = {
      view: updated.view,
      download: updated.download,
      itemType: item.itemType,
    };
  }

  const cascadeDown = (subItems: TreeNode[] | undefined) => {
    if (!subItems) return;
    for (const subItem of subItems) {
      if (subItem.id !== VIRTUAL_ROOT_ID) {
        changes[subItem.id] = {
          view: updated.view,
          download: updated.download,
          itemType: subItem.itemType,
        };
      }
      cascadeDown(subItem.subItems);
    }
  };
  cascadeDown(item.subItems);

  // Diff against the pre-toggle snapshot (the tree we were handed reflects
  // state *before* the user's click) so we can tell apart the three
  // ancestor-update modes below.
  const previousDownload = item.permissions.download;
  const downloadTurnedOff =
    previousDownload && !updated.download && updated.view;

  if (!updated.view) {
    // Turning view (and therefore download) off. Walk parents bottom-up and
    // recompute view+download from the remaining siblings.
    //
    // We track ancestors that have already flipped to view=false in this
    // pass so higher-level parents don't *still* see them as viewable in the
    // pre-toggle snapshot — otherwise a chain like `f1 > f1a > doc1` where
    // doc1 is the only viewable item would correctly flip f1a to invisible
    // but leave f1 visible (because f1a still has view=true in the snapshot
    // we hold by reference).
    const flippedToInvisible = new Set<string>([item.id]);
    for (const parent of [...parents].reverse()) {
      if (parent.id === VIRTUAL_ROOT_ID) continue;
      const otherChildren =
        parent.subItems?.filter(
          (sub) => !flippedToInvisible.has(sub.id),
        ) ?? [];
      const someSubItemViewable = otherChildren.some(
        (sub) => sub.permissions.view,
      );
      const someSubItemDownloadable = otherChildren.some(
        (sub) => sub.permissions.download,
      );
      changes[parent.id] = {
        view: someSubItemViewable,
        download: someSubItemDownloadable,
        itemType: parent.itemType,
      };
      if (!someSubItemViewable) {
        flippedToInvisible.add(parent.id);
      }
    }
  } else if (downloadTurnedOff) {
    // View stays on, download was just turned off. Walk parents bottom-up
    // and recompute download from the remaining siblings — same shape as
    // the view-off branch but only for the download flag. Without this, a
    // folder whose *only* downloadable descendant just got turned off
    // would silently keep `canDownload=true` in the DB, even though the
    // optimistic UI correctly shows it as no-longer-downloadable.
    const flippedToNonDownloadable = new Set<string>([item.id]);
    for (const parent of [...parents].reverse()) {
      if (parent.id === VIRTUAL_ROOT_ID) continue;
      const otherChildren =
        parent.subItems?.filter(
          (sub) => !flippedToNonDownloadable.has(sub.id),
        ) ?? [];
      const someSubItemDownloadable = otherChildren.some(
        (sub) => sub.permissions.download,
      );
      changes[parent.id] = {
        // The toggled item kept view=true, so by the "download requires
        // view" invariant every ancestor must have view=true too. We don't
        // need to recompute view here.
        view: true,
        download: someSubItemDownloadable,
        itemType: parent.itemType,
      };
      if (!someSubItemDownloadable) {
        flippedToNonDownloadable.add(parent.id);
      }
    }
  } else {
    // Turning view and/or download ON (or a no-op toggle). Force ancestors
    // visible; bump their download to true only when the user explicitly
    // turned download on, otherwise preserve their existing download flag
    // so we don't clobber an ancestor's previously-granted download grant.
    for (const parent of parents) {
      if (parent.id === VIRTUAL_ROOT_ID) continue;
      changes[parent.id] = {
        view: true,
        download: updated.download ? true : parent.permissions.download,
        itemType: parent.itemType,
      };
    }
  }

  return changes;
}

/**
 * Build the change set for a "set permissions on the virtual root" toggle.
 * Every real item in the tree gets the new permission. The virtual root is
 * never written to the DB.
 */
export function collectChangesForRoot(
  treeRootedAtVirtualRoot: TreeNode[],
  rawPermissions: { view: boolean; download: boolean },
): PermissionChanges {
  const updated = normalizePermissions(rawPermissions);
  const changes: PermissionChanges = {};

  const walk = (items: TreeNode[]) => {
    for (const item of items) {
      if (item.id !== VIRTUAL_ROOT_ID) {
        changes[item.id] = {
          view: updated.view,
          download: updated.download,
          itemType: item.itemType,
        };
      }
      if (item.subItems) walk(item.subItems);
    }
  };
  walk(treeRootedAtVirtualRoot);

  return changes;
}

/**
 * Translate a fresh `(view, download)` pair coming out of the multi-select
 * ToggleGroup in the group-permissions UI into the user's actual intent,
 * using the previous state to disambiguate which button they pressed.
 *
 * The "download requires view" invariant goes in two directions:
 *   - turning view OFF must also turn download OFF
 *   - turning download ON must also turn view ON (otherwise clicking the
 *     download icon on a hidden item is a no-op, which feels broken)
 *
 * Without comparing to the previous state we cannot tell a user *adding*
 * download from a user *removing* view: both can produce `["download"]`
 * from a multi-select toggle group.
 */
export function resolveToggleIntent(
  previous: { view: boolean; download: boolean },
  next: { view: boolean; download: boolean },
): { view: boolean; download: boolean } {
  const userTurnedViewOff = previous.view && !next.view;
  if (userTurnedViewOff) {
    return { view: false, download: false };
  }

  const userTurnedDownloadOn = !previous.download && next.download;
  if (userTurnedDownloadOn && !next.view) {
    return { view: true, download: true };
  }

  return next;
}

/**
 * Aggregate state for a folder row in the group-permissions UI: in addition
 * to the persisted `view`/`download` flags, the UI also renders an
 * "indeterminate" (gray) state when *some* but not *all* of the folder's
 * descendants are visible/downloadable.
 */
export type AggregatePermissions = {
  view: boolean;
  download: boolean;
  partialView: boolean;
  partialDownload: boolean;
};

/**
 * A child row's contribution to its parent folder's aggregate state. The
 * `partial*` flags are what let the indeterminate state propagate *up* the
 * tree: a folder is partial whenever any direct child is partial OR any
 * direct child is fully off, even if every direct child reports
 * `view=true` (because each of those children is itself partial).
 *
 * Without this, a folder like `Company Information` whose only-hidden item
 * is several levels deep would render as fully visible, because each of its
 * direct subfolders has `view=true` (they have *some* viewable descendant).
 */
export type AggregateChild = {
  view: boolean;
  download: boolean;
  partialView?: boolean;
  partialDownload?: boolean;
};

/**
 * Compute a folder's aggregate permission state from its direct children.
 * Returns `null` if there are no children (caller should fall back to the
 * folder's own persisted permissions).
 *
 * Rules:
 *  - `view` is true iff at least one direct child contributes view=true.
 *  - `partialView` is true iff `view` is true AND at least one direct child
 *    is either view=false or itself partial. The same holds for download.
 */
export function aggregateFolderPermissions(
  children: AggregateChild[],
): AggregatePermissions | null {
  if (children.length === 0) return null;

  const someViewable = children.some((c) => c.view);
  const allViewable = children.every((c) => c.view);
  const someChildPartialView = children.some((c) => c.partialView === true);

  const someDownloadable = children.some((c) => c.download);
  const allDownloadable = children.every((c) => c.download);
  const someChildPartialDownload = children.some(
    (c) => c.partialDownload === true,
  );

  return {
    view: someViewable,
    partialView: someViewable && (!allViewable || someChildPartialView),
    download: someDownloadable,
    partialDownload:
      someDownloadable && (!allDownloadable || someChildPartialDownload),
  };
}

/**
 * Returns the ids of all real ancestor folders of `targetId` in `tree`,
 * skipping the virtual root. Used to assert (in tests) that
 * `collectChangesForItem` includes a complete ancestor chain when toggling
 * a permission on.
 */
export function ancestorFolderIdsOf(
  tree: TreeNode[],
  targetId: string,
): string[] {
  const found = findItemAndParents(tree, targetId);
  if (!found) return [];
  return found.parents
    .filter((p) => p.id !== VIRTUAL_ROOT_ID)
    .map((p) => p.id);
}
