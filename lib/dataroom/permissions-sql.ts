import { ItemType, Prisma } from "@prisma/client";

/**
 * SQL builders for bulk-saving dataroom permissions.
 *
 * Replaces per-row `prisma.*.upsert(...)` loops inside
 * `prisma.$transaction(async (tx) => …)` blocks, which needed thousands of
 * round-trips on large datarooms and reliably timed out Prisma's interactive
 * transaction window for big "Save changes" payloads.
 *
 * Two consumers share these builders:
 *   1. **Viewer groups** (admin-side dataroom permissions UI) — writes to
 *      `ViewerGroupAccessControls`. Append-only delta semantics: only rows
 *      in the user's payload are upserted; nothing is deleted.
 *   2. **Link permission groups** (per-link permission overrides) — writes
 *      to `PermissionGroupAccessControls`. Set-everything semantics: the
 *      caller posts the complete desired state, so any DB row not in the
 *      payload (or in the computed ancestor set) is deleted.
 *
 * Both tables share the columns we touch:
 *   `id, groupId, itemId, itemType, canView, canDownload, createdAt, updatedAt`
 *
 * `PermissionGroupAccessControls` has an extra `canDownloadOriginal Boolean
 * @default(false)`. We intentionally never reference it in the SET clause
 * here so its existing value is preserved on update and the column default
 * fills in for INSERT — same shape as the previous Prisma client code path.
 *
 * `id` values are generated client-side as cuids — same convention as the
 * rest of the schema's `@id @default(cuid())` columns — and passed in as
 * normal bound parameters.
 *
 * Row data is bound as one Postgres array parameter per column and expanded
 * server-side with `unnest(...)`, so every statement uses a small constant
 * number of bind variables no matter how many rows are in the payload.
 * Postgres's extended protocol caps a prepared statement at 32,767 bind
 * variables (int16), so the per-row `(VALUES ($1,$2,…),…)` shape this
 * replaces fell over at ~6.5k rows ("too many bind variables", P2035).
 *
 * All builders are pure functions over their inputs so we can assert their
 * shape in unit tests without spinning up Postgres.
 */

/**
 * The two access-control tables we know how to bulk-write to. The literal
 * string is interpolated into the SQL with `Prisma.raw`, which is safe here
 * because the value is a closed union type — it cannot be supplied by user
 * input, only by callers in this codebase.
 */
export type AccessControlTable =
  | "ViewerGroupAccessControls"
  | "PermissionGroupAccessControls";

const tableRef = (table: AccessControlTable): Prisma.Sql =>
  Prisma.raw(`"${table}"`);

export type PermissionUpsertRow = {
  /** Pre-generated cuid (same format as `@id @default(cuid())`). */
  id: string;
  itemId: string;
  itemType: ItemType;
  canView: boolean;
  canDownload: boolean;
};

export type AncestorUpsertRow = {
  /** Pre-generated cuid for the new access-control row. */
  id: string;
  folderId: string;
};

/**
 * Build the bulk upsert SQL for the user-supplied payload.
 *
 * Returns `null` when `rows` is empty so the caller can skip the round-trip.
 */
export function buildBulkUpsertPermissionsSql(
  table: AccessControlTable,
  groupId: string,
  rows: PermissionUpsertRow[],
): Prisma.Sql | null {
  if (rows.length === 0) return null;

  // We sort by itemId so the row-lock order is stable across concurrent
  // saves for the same group — same property the previous loop relied on.
  const sortedRows = [...rows].sort((a, b) => a.itemId.localeCompare(b.itemId));

  // One array bind per column (6 bind variables total, incl. groupId) —
  // never per row — so payload size can't hit the 32,767 bind-variable cap.
  const ids = sortedRows.map((row) => row.id);
  const itemIds = sortedRows.map((row) => row.itemId);
  const itemTypes = sortedRows.map((row) => row.itemType as string);
  const canViews = sortedRows.map((row) => row.canView);
  const canDownloads = sortedRows.map((row) => row.canDownload);

  return Prisma.sql`
    INSERT INTO ${tableRef(table)} (
      "id",
      "groupId",
      "itemId",
      "itemType",
      "canView",
      "canDownload",
      "createdAt",
      "updatedAt"
    )
    SELECT
      v."id",
      ${groupId},
      v."itemId",
      v."itemType"::"ItemType",
      v."canView",
      v."canDownload",
      NOW(),
      NOW()
    FROM unnest(
      ${ids}::text[],
      ${itemIds}::text[],
      ${itemTypes}::text[],
      ${canViews}::boolean[],
      ${canDownloads}::boolean[]
    ) AS v("id", "itemId", "itemType", "canView", "canDownload")
    ON CONFLICT ("groupId", "itemId") DO UPDATE SET
      "itemType" = EXCLUDED."itemType",
      "canView" = EXCLUDED."canView",
      "canDownload" = EXCLUDED."canDownload",
      "updatedAt" = NOW();
  `;
}

/**
 * Build a single recursive-CTE statement that returns the distinct ancestor
 * folder ids of every item in the payload that is being made visible.
 *
 * Returns `null` when there's nothing visible (no walk needed).
 *
 * Notes:
 * - Constrained to `dataroomId` so a malicious or buggy caller can't trick
 *   us into walking folders in a different dataroom.
 * - Folder→parent walking starts from each visible folder *and* from each
 *   visible document's `folderId`. Root-level documents have no folder, so
 *   they're filtered out (correct: they have no ancestor to make visible).
 *
 * Independent of the access-control table — this only walks
 * `DataroomFolder` / `DataroomDocument` and is shared by both consumers.
 */
export function buildFindAncestorFolderIdsSql(
  dataroomId: string,
  visibleDocumentIds: string[],
  visibleFolderIds: string[],
): Prisma.Sql | null {
  if (visibleDocumentIds.length === 0 && visibleFolderIds.length === 0) {
    return null;
  }

  // Each id list is bound as a single array parameter (2 bind variables
  // total) instead of one variable per id. Empty arrays don't bind cleanly
  // through `= ANY($1::text[])` in every driver path, so substitute a
  // no-match empty array literal when the input is empty.
  const folderArray =
    visibleFolderIds.length > 0
      ? Prisma.sql`${visibleFolderIds}::text[]`
      : Prisma.sql`ARRAY[]::text[]`;
  const documentArray =
    visibleDocumentIds.length > 0
      ? Prisma.sql`${visibleDocumentIds}::text[]`
      : Prisma.sql`ARRAY[]::text[]`;

  return Prisma.sql`
    WITH RECURSIVE
      starting_folders AS (
        SELECT df."id" AS folder_id
        FROM "DataroomFolder" df
        WHERE df."id" = ANY(${folderArray})
          AND df."dataroomId" = ${dataroomId}

        UNION

        SELECT dd."folderId" AS folder_id
        FROM "DataroomDocument" dd
        WHERE dd."id" = ANY(${documentArray})
          AND dd."dataroomId" = ${dataroomId}
          AND dd."folderId" IS NOT NULL
      ),
      ancestor_folders AS (
        SELECT folder_id FROM starting_folders

        UNION

        SELECT df."parentId" AS folder_id
        FROM ancestor_folders af
        JOIN "DataroomFolder" df ON df."id" = af.folder_id
        WHERE df."parentId" IS NOT NULL
      )
    SELECT DISTINCT folder_id
    FROM ancestor_folders
    WHERE folder_id IS NOT NULL;
  `;
}

/**
 * Bulk-upsert the ancestor folder rows produced by
 * `buildFindAncestorFolderIdsSql`. Forces `canView=true` and never touches
 * `canDownload` so we don't clobber an ancestor's existing download grant.
 *
 * The `WHERE existing.canView = FALSE` guard skips no-op writes when the
 * ancestor is already visible — typical case in steady state.
 */
export function buildUpsertAncestorVisibilitySql(
  table: AccessControlTable,
  groupId: string,
  ancestors: AncestorUpsertRow[],
): Prisma.Sql | null {
  if (ancestors.length === 0) return null;

  // Stable lock order to match the main bulk-upsert path.
  const sorted = [...ancestors].sort((a, b) =>
    a.folderId.localeCompare(b.folderId),
  );

  // Array binds (3 bind variables total, incl. groupId) — see module doc.
  const ids = sorted.map((row) => row.id);
  const folderIds = sorted.map((row) => row.folderId);

  return Prisma.sql`
    INSERT INTO ${tableRef(table)} (
      "id",
      "groupId",
      "itemId",
      "itemType",
      "canView",
      "canDownload",
      "createdAt",
      "updatedAt"
    )
    SELECT
      v."id",
      ${groupId},
      v."folderId",
      'DATAROOM_FOLDER'::"ItemType",
      TRUE,
      FALSE,
      NOW(),
      NOW()
    FROM unnest(
      ${ids}::text[],
      ${folderIds}::text[]
    ) AS v("id", "folderId")
    ON CONFLICT ("groupId", "itemId") DO UPDATE SET
      "canView" = TRUE,
      "updatedAt" = NOW()
    WHERE ${tableRef(table)}."canView" = FALSE;
  `;
}

/**
 * Build a `DELETE` for rows in `table` belonging to `groupId` whose `itemId`
 * is *not* in `keepItemIds`. This is the link-permission "set the entire
 * permission state" semantic — anything no longer in the desired payload
 * (after ancestor expansion) is removed.
 *
 * Returns `null` when `keepItemIds` is empty so the caller can decide
 * whether to wipe everything for the group or skip the call entirely. Most
 * link saves should always include something (at minimum the toggled item
 * and its ancestors), so an empty array is unusual.
 */
export function buildDeletePermissionsNotInPayloadSql(
  table: AccessControlTable,
  groupId: string,
  keepItemIds: string[],
): Prisma.Sql | null {
  if (keepItemIds.length === 0) return null;

  // Deduped and bound as one array parameter (2 bind variables total) so
  // huge payloads can't exceed the prepared-statement bind-variable cap.
  const uniqueIds = Array.from(new Set(keepItemIds));

  return Prisma.sql`
    DELETE FROM ${tableRef(table)}
    WHERE "groupId" = ${groupId}
      AND NOT ("itemId" = ANY(${uniqueIds}::text[]));
  `;
}

/**
 * Convenience: split the payload (whatever the client posted) into the two
 * id arrays the recursive CTE needs.
 */
export function extractVisibleItemIds(
  permissions: Record<
    string,
    { itemType: ItemType; view: boolean; download: boolean }
  >,
): { visibleDocumentIds: string[]; visibleFolderIds: string[] } {
  const visibleDocumentIds: string[] = [];
  const visibleFolderIds: string[] = [];
  for (const [itemId, perm] of Object.entries(permissions)) {
    if (!perm.view) continue;
    if (perm.itemType === ItemType.DATAROOM_DOCUMENT) {
      visibleDocumentIds.push(itemId);
    } else if (perm.itemType === ItemType.DATAROOM_FOLDER) {
      visibleFolderIds.push(itemId);
    }
  }
  return { visibleDocumentIds, visibleFolderIds };
}
