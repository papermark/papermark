import { ItemType, Prisma } from "@prisma/client";

import cuid from "cuid";

import {
  type AccessControlTable,
  type AncestorUpsertRow,
  type PermissionUpsertRow,
  buildBulkUpsertPermissionsSql,
  buildDeletePermissionsNotInPayloadSql,
  buildFindAncestorFolderIdsSql,
  buildUpsertAncestorVisibilitySql,
} from "@/lib/dataroom/permissions-sql";
import prisma from "@/lib/prisma";

/**
 * Canonical writer for dataroom access-control rows, shared by every consumer
 * that saves per-item permissions (viewer groups and per-link permission
 * groups). It owns the sensitive parts of the save — dedupe, the recursive
 * ancestor-visibility expansion, transaction timing, and which bulk SQL runs
 * in which order — so the delta and full-replace semantics can't drift apart
 * across call sites. Routes keep only validation, target resolution, and
 * serialization.
 *
 * The two write modes:
 *   - `delta`: entries in the payload are upserted; omitted items keep their
 *     current state. Nothing is deleted. (Viewer-group semantics.)
 *   - `replace`: the payload (plus its ancestor expansion) is the complete
 *     desired state; any row not in it is deleted. An empty payload clears
 *     every row for the group. (Per-link permission-group semantics.)
 *
 * In both modes, ancestor folders of any item made visible are forced to
 * `canView: true` so the folder tree stays navigable.
 */

export type PermissionWriteMode = "delta" | "replace";

/** A single normalized permission entry (internal shape, not the public API). */
export type PermissionEntryInput = {
  itemId: string;
  itemType: ItemType;
  canView: boolean;
  canDownload: boolean;
};

export type PermissionWriteTarget = {
  table: AccessControlTable;
  /**
   * Resolve the group id to write to. Runs inside the write transaction so
   * callers that must create/claim a group atomically (per-link permission
   * groups) can do so without a second transaction; callers with a known
   * group id just return it.
   */
  resolveGroupId: (tx: Prisma.TransactionClient) => Promise<string>;
};

/**
 * One effective access-control row, normalized across both tables.
 * `ViewerGroupAccessControls` has no `canDownloadOriginal` column, so it is
 * surfaced as `false` there — giving both serializers a single row shape.
 */
export type EffectivePermissionRow = {
  id: string;
  itemId: string;
  itemType: ItemType;
  canView: boolean;
  canDownload: boolean;
  canDownloadOriginal: boolean;
  updatedAt: Date;
};

export type ApplyDataroomPermissionsResult = {
  groupId: string;
  /** Payload items plus auto-upserted ancestor folders. */
  touchedItemIds: string[];
  /** Effective rows for every touched item, ordered by id. */
  rows: EffectivePermissionRow[];
};

export async function applyDataroomPermissions({
  target,
  dataroomId,
  entries,
  mode,
}: {
  target: PermissionWriteTarget;
  dataroomId: string;
  entries: PermissionEntryInput[];
  mode: PermissionWriteMode;
}): Promise<ApplyDataroomPermissionsResult> {
  const { table, resolveGroupId } = target;

  // Last entry wins when the same item appears twice.
  const dedupedEntries = Array.from(
    new Map(entries.map((e) => [e.itemId, e])).values(),
  );

  const upsertRows: PermissionUpsertRow[] = dedupedEntries.map((e) => ({
    id: cuid(),
    itemId: e.itemId,
    itemType: e.itemType,
    canView: e.canView,
    canDownload: e.canDownload,
  }));

  const visibleDocumentIds: string[] = [];
  const visibleFolderIds: string[] = [];
  for (const e of dedupedEntries) {
    if (!e.canView) continue;
    switch (e.itemType) {
      case ItemType.DATAROOM_DOCUMENT:
        visibleDocumentIds.push(e.itemId);
        break;
      case ItemType.DATAROOM_FOLDER:
        visibleFolderIds.push(e.itemId);
        break;
      default: {
        const _exhaustive: never = e.itemType;
        throw new Error(`Unhandled item type: ${_exhaustive}`);
      }
    }
  }

  // The ancestor CTE only reads DataroomFolder/DataroomDocument (immutable
  // from this caller's perspective) and doesn't depend on the group id, so we
  // build it once here. The group-scoped upsert/delete SQL is built inside the
  // transaction, after the group id is resolved.
  const findAncestorsSql = buildFindAncestorFolderIdsSql(
    dataroomId,
    visibleDocumentIds,
    visibleFolderIds,
  );

  const { groupId, ancestorIds } = await prisma.$transaction(
    async (tx) => {
      const resolvedGroupId = await resolveGroupId(tx);

      const bulkUpsertSql = buildBulkUpsertPermissionsSql(
        table,
        resolvedGroupId,
        upsertRows,
      );
      if (bulkUpsertSql) {
        await tx.$executeRaw(bulkUpsertSql);
      }

      const ancestors = new Set<string>();
      if (findAncestorsSql) {
        const ancestorRows =
          await tx.$queryRaw<{ folder_id: string }[]>(findAncestorsSql);
        for (const r of ancestorRows) ancestors.add(r.folder_id);

        if (ancestorRows.length > 0) {
          const ancestorRowsToUpsert: AncestorUpsertRow[] = ancestorRows.map(
            (r) => ({ id: cuid(), folderId: r.folder_id }),
          );
          const ancestorUpsertSql = buildUpsertAncestorVisibilitySql(
            table,
            resolvedGroupId,
            ancestorRowsToUpsert,
          );
          if (ancestorUpsertSql) {
            await tx.$executeRaw(ancestorUpsertSql);
          }
        }
      }

      if (mode === "replace") {
        const keepItemIds = [
          ...dedupedEntries.map((e) => e.itemId),
          ...ancestors,
        ];
        if (keepItemIds.length > 0) {
          const deleteSql = buildDeletePermissionsNotInPayloadSql(
            table,
            resolvedGroupId,
            keepItemIds,
          );
          if (deleteSql) {
            await tx.$executeRaw(deleteSql);
          }
        } else {
          // Empty desired state → caller is clearing every override.
          await deleteAllPermissionsForGroup(tx, table, resolvedGroupId);
        }
      }

      return { groupId: resolvedGroupId, ancestorIds: Array.from(ancestors) };
    },
    // Prisma's default interactive-transaction timeout is 5s, which a
    // 1000-entry payload can exceed under load — align with the routes'
    // maxDuration budget instead of failing with P2028.
    { maxWait: 10_000, timeout: 120_000 },
  );

  const touchedItemIds = Array.from(
    new Set([...dedupedEntries.map((e) => e.itemId), ...ancestorIds]),
  );

  const rows = await fetchEffectivePermissionRows(
    table,
    groupId,
    touchedItemIds,
  );

  return { groupId, touchedItemIds, rows };
}

async function deleteAllPermissionsForGroup(
  tx: Prisma.TransactionClient,
  table: AccessControlTable,
  groupId: string,
): Promise<void> {
  switch (table) {
    case "ViewerGroupAccessControls":
      await tx.viewerGroupAccessControls.deleteMany({ where: { groupId } });
      return;
    case "PermissionGroupAccessControls":
      await tx.permissionGroupAccessControls.deleteMany({ where: { groupId } });
      return;
    default: {
      const _exhaustive: never = table;
      throw new Error(`Unhandled access-control table: ${_exhaustive}`);
    }
  }
}

async function fetchEffectivePermissionRows(
  table: AccessControlTable,
  groupId: string,
  touchedItemIds: string[],
): Promise<EffectivePermissionRow[]> {
  switch (table) {
    case "ViewerGroupAccessControls": {
      const rows = await prisma.viewerGroupAccessControls.findMany({
        where: { groupId, itemId: { in: touchedItemIds } },
        orderBy: { id: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        itemId: r.itemId,
        itemType: r.itemType,
        canView: r.canView,
        canDownload: r.canDownload,
        canDownloadOriginal: false,
        updatedAt: r.updatedAt,
      }));
    }
    case "PermissionGroupAccessControls": {
      const rows = await prisma.permissionGroupAccessControls.findMany({
        where: { groupId, itemId: { in: touchedItemIds } },
        orderBy: { id: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        itemId: r.itemId,
        itemType: r.itemType,
        canView: r.canView,
        canDownload: r.canDownload,
        canDownloadOriginal: r.canDownloadOriginal,
        updatedAt: r.updatedAt,
      }));
    }
    default: {
      const _exhaustive: never = table;
      throw new Error(`Unhandled access-control table: ${_exhaustive}`);
    }
  }
}
