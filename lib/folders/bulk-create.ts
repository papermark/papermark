import { DefaultPermissionStrategy, ItemType, Prisma } from "@prisma/client";

import { resolveRootItemAccessFlags } from "@/lib/dataroom/root-item-access";
import { safeSlugify } from "@/lib/utils";

/**
 * Bulk creation of folder trees in a single transaction, used by the
 * dataroom upload-zone to materialize a dropped directory hierarchy in one
 * round-trip instead of N (one POST per folder).
 *
 * Two scoped variants are exported:
 *   - bulkCreateMainDocsFolders → Folder model (all-documents)
 *   - bulkCreateDataroomFolders → DataroomFolder model + default permissions
 *
 * Both share the same shape so the upload-zone can drive them in parallel.
 */

/** Maximum suffix " (N)" we'll try for slug-collision resolution. */
const MAX_SLUG_SUFFIX = 50;

/** Keep one bulk request bounded; callers can split larger trees if needed. */
export const MAX_BULK_FOLDERS_PER_REQUEST = 500;

/**
 * How many times to re-resolve paths and re-attempt the level insert when a
 * concurrent bulk request commits a colliding slug between our SELECT and our
 * INSERT. 3 is enough for realistic concurrency (we already rate-limit to
 * 10/min/user) without risking long retry storms.
 */
const MAX_INSERT_RETRIES = 3;

/**
 * Wraps `attempt` in a Postgres SAVEPOINT so that a failure inside the
 * callback (notably P2002 from a concurrent path insert) doesn't abort the
 * surrounding interactive transaction. On a unique-constraint error we roll
 * back to the savepoint and let the caller re-resolve and retry.
 *
 * Without the savepoint, Prisma + Postgres would leave the transaction in an
 * aborted state after the first P2002, so any retry would fail with
 * "current transaction is aborted, commands ignored until end of transaction
 * block".
 */
async function withUniqueConstraintRetry<T>(args: {
  tx: Prisma.TransactionClient;
  savepointName: string;
  attempt: () => Promise<T>;
}): Promise<T> {
  const { tx, savepointName, attempt } = args;
  let lastError: unknown;

  for (let i = 0; i <= MAX_INSERT_RETRIES; i++) {
    await tx.$executeRawUnsafe(`SAVEPOINT "${savepointName}"`);
    try {
      const result = await attempt();
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT "${savepointName}"`);
      return result;
    } catch (error) {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${savepointName}"`);
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT "${savepointName}"`);

      if (
        i < MAX_INSERT_RETRIES &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

export interface BulkFolderInput {
  /** Client-generated id, unique within this request. */
  tempId: string;
  /** Folder name shown to the user. */
  name: string;
  /**
   * Parent reference within this batch. null/undefined means the folder is
   * a direct child of either `parentPath` (if set) or the request-level
   * `rootPath`.
   */
  parentTempId?: string | null;
  /**
   * Absolute path of an existing folder in the DB (e.g. one created by a
   * prior bulk chunk). Lets the client split very large trees across
   * multiple requests: chunk 2 can reference parents from chunk 1 by path.
   * Ignored if `parentTempId` is set.
   */
  parentPath?: string | null;
  /**
   * Position among this folder's siblings, counting from 0. Written straight
   * to DataroomFolder.orderIndex, so callers that import into a parent which
   * already has ordered children must offset first (see
   * `appendRootChildrenAfterExisting`). Ignored by the all-documents Folder
   * model, which has no orderIndex column. Null leaves orderIndex null, which
   * sorts the folder after every numbered sibling.
   */
  orderIndex?: number | null;
}

export interface BulkFolderResult {
  tempId: string;
  id: string;
  name: string;
  path: string;
  parentId: string | null;
}

class BulkValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BulkValidationError";
  }
}

export function getSafeBulkValidationMessage(code: string): string {
  switch (code) {
    case "UNKNOWN_ROOT_PATH":
    case "UNKNOWN_PARENT_PATH":
      return "Parent folder does not exist or is unavailable";
    case "MISSING_TEMP_ID":
    case "DUPLICATE_TEMP_ID":
    case "UNKNOWN_PARENT":
    case "CYCLE":
      return "Invalid folder hierarchy";
    case "EMPTY_NAME":
      return "Folder names cannot be empty";
    case "SLUG_EXHAUSTED":
      return "Too many folders with similar names";
    case "TOO_MANY_FOLDERS":
      return `Too many folders in a single request (max ${MAX_BULK_FOLDERS_PER_REQUEST})`;
    default:
      return "Invalid folder request";
  }
}

/** Validates the input is a topologically-sortable forest of folders. */
function buildLevels(folders: BulkFolderInput[]): BulkFolderInput[][] {
  if (folders.length === 0) return [];

  // Defense-in-depth: API routes already cap via Zod, but the bulk creators
  // are exported and may be called from other code paths (background jobs,
  // future endpoints) that bypass the schema. Reject oversized batches here
  // before doing any work.
  if (folders.length > MAX_BULK_FOLDERS_PER_REQUEST) {
    throw new BulkValidationError(
      "TOO_MANY_FOLDERS",
      `Too many folders in a single request (got ${folders.length}, max ${MAX_BULK_FOLDERS_PER_REQUEST})`,
    );
  }

  const byId = new Map<string, BulkFolderInput>();
  for (const f of folders) {
    if (!f.tempId) {
      throw new BulkValidationError(
        "MISSING_TEMP_ID",
        "Each folder needs a tempId",
      );
    }
    if (!f.name || f.name.trim() === "") {
      throw new BulkValidationError(
        "EMPTY_NAME",
        `Folder ${f.tempId} has an empty name`,
      );
    }
    if (byId.has(f.tempId)) {
      throw new BulkValidationError(
        "DUPLICATE_TEMP_ID",
        `Duplicate tempId: ${f.tempId}`,
      );
    }
    byId.set(f.tempId, f);
  }

  const depth = new Map<string, number>();
  const computeDepth = (f: BulkFolderInput, seen: Set<string>): number => {
    const cached = depth.get(f.tempId);
    if (cached !== undefined) return cached;
    if (seen.has(f.tempId)) {
      throw new BulkValidationError("CYCLE", `Cycle detected via ${f.tempId}`);
    }
    seen.add(f.tempId);
    if (!f.parentTempId) {
      depth.set(f.tempId, 0);
      return 0;
    }
    const parent = byId.get(f.parentTempId);
    if (!parent) {
      throw new BulkValidationError(
        "UNKNOWN_PARENT",
        `Folder ${f.tempId} references unknown parent ${f.parentTempId}`,
      );
    }
    const d = computeDepth(parent, seen) + 1;
    depth.set(f.tempId, d);
    seen.delete(f.tempId);
    return d;
  };

  for (const f of folders) computeDepth(f, new Set());

  const levels: BulkFolderInput[][] = [];
  for (const f of folders) {
    const d = depth.get(f.tempId)!;
    (levels[d] ??= []).push(f);
  }
  return levels;
}

/**
 * Resolves the parent path of a folder for slug-collision computation.
 * Order of precedence: parentTempId (parent created in this batch) →
 * parentPath (parent created in a prior chunk / existing in DB) → rootPath.
 */
function parentPathOf(
  f: BulkFolderInput,
  pathByTemp: Map<string, string>,
  rootPath: string,
): string {
  if (f.parentTempId) return pathByTemp.get(f.parentTempId)!;
  if (f.parentPath) return f.parentPath;
  return rootPath;
}

/**
 * Resolves the DB id of a folder's parent. Same precedence as parentPathOf.
 * Throws UNKNOWN_PARENT_PATH if the input references an external path that
 * doesn't exist in the scope-pre-loaded map.
 */
function resolveParentId(
  f: BulkFolderInput,
  idByTemp: Map<string, string>,
  externalParentPathToId: Map<string, string>,
  rootParentId: string | null,
): string | null {
  if (f.parentTempId) return idByTemp.get(f.parentTempId)!;
  if (f.parentPath) {
    const id = externalParentPathToId.get(f.parentPath);
    if (!id) {
      throw new BulkValidationError(
        "UNKNOWN_PARENT_PATH",
        `Parent path ${f.parentPath} does not exist`,
      );
    }
    return id;
  }
  return rootParentId;
}

/**
 * One-shot lookup of every external `parentPath` referenced by the input.
 * Cheaper than per-folder lookups and avoids racing with concurrent inserts.
 */
async function resolveExternalParentPaths(
  folders: BulkFolderInput[],
  findRows: (paths: string[]) => Promise<{ id: string; path: string }[]>,
): Promise<Map<string, string>> {
  const paths = new Set<string>();
  for (const f of folders) {
    if (!f.parentTempId && f.parentPath) paths.add(f.parentPath);
  }
  if (paths.size === 0) return new Map();
  const rows = await findRows(Array.from(paths));
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.path, r.id);
  for (const p of paths) {
    if (!map.has(p)) {
      throw new BulkValidationError(
        "UNKNOWN_PARENT_PATH",
        `Parent path ${p} does not exist`,
      );
    }
  }
  return map;
}

/**
 * Assigns every folder at one tree level its final, collision-free path.
 *
 * Asking for all MAX_SLUG_SUFFIX fallbacks up front costs 51 bind parameters
 * per folder, which puts a 500-folder level over 25k parameters and near
 * Postgres' 65535 limit. Almost no import actually collides, so this asks for
 * the plain slugs first and only pays for fallbacks on the folders that can
 * collide with something.
 *
 * Returns the resolved name and path per tempId.
 */
async function resolveLevelPaths(args: {
  level: BulkFolderInput[];
  /** Returns the absolute path of the parent for a given input folder. */
  parentPathOf: (f: BulkFolderInput) => string;
  /** SELECT all existing folder paths that match any candidate. */
  findExisting: (candidatePaths: string[]) => Promise<{ path: string }[]>;
}): Promise<Map<string, { name: string; path: string }>> {
  const { level, parentPathOf, findExisting } = args;
  if (level.length === 0) return new Map();

  const candidatesPerFolder: {
    tempId: string;
    name: string;
    basePathPrefix: string;
    basePath: string;
    candidates: string[];
  }[] = [];
  const indicesByBasePath = new Map<string, number[]>();

  for (const [index, f] of level.entries()) {
    const parentPath = parentPathOf(f);
    const basePathPrefix = parentPath === "/" ? "/" : parentPath + "/";
    const basePath = basePathPrefix + safeSlugify(f.name);
    candidatesPerFolder.push({
      tempId: f.tempId,
      name: f.name,
      basePathPrefix,
      basePath,
      candidates: [basePath],
    });
    const siblings = indicesByBasePath.get(basePath);
    if (siblings) siblings.push(index);
    else indicesByBasePath.set(basePath, [index]);
  }

  const taken = new Set(
    (await findExisting(Array.from(indicesByBasePath.keys()))).map(
      (r) => r.path,
    ),
  );

  const needsSuffixes = new Set<number>();
  const pending: number[] = [];
  const markContested = (index: number) => {
    if (needsSuffixes.has(index)) return;
    needsSuffixes.add(index);
    pending.push(index);
  };

  for (const [basePath, indices] of indicesByBasePath) {
    // Only the first of N same-named siblings can keep the base path.
    if (taken.has(basePath) || indices.length > 1) {
      indices.forEach(markContested);
    }
  }

  // A folder literally named "Foo (1)" is uncontested on its own, but becomes
  // contested once some "Foo" in the same batch may claim that exact path.
  const suffixCandidates = new Set<string>();
  while (pending.length > 0) {
    const entry = candidatesPerFolder[pending.pop()!];
    for (let i = 1; i <= MAX_SLUG_SUFFIX; i++) {
      const candidate =
        entry.basePathPrefix + safeSlugify(`${entry.name} (${i})`);
      entry.candidates.push(candidate);
      if (suffixCandidates.has(candidate)) continue;
      suffixCandidates.add(candidate);
      indicesByBasePath.get(candidate)?.forEach(markContested);
    }
  }

  if (suffixCandidates.size > 0) {
    for (const row of await findExisting(Array.from(suffixCandidates))) {
      taken.add(row.path);
    }
  }

  const resolved = new Map<string, { name: string; path: string }>();
  for (const entry of candidatesPerFolder) {
    let pickedPath: string | undefined;
    let pickedName: string | undefined;
    for (let i = 0; i < entry.candidates.length; i++) {
      const candidate = entry.candidates[i];
      if (!taken.has(candidate)) {
        pickedPath = candidate;
        pickedName = i === 0 ? entry.name : `${entry.name} (${i})`;
        break;
      }
    }
    if (!pickedPath || !pickedName) {
      throw new BulkValidationError(
        "SLUG_EXHAUSTED",
        `Could not find a free slug for "${entry.name}" under ${entry.basePathPrefix}`,
      );
    }
    // The batch's own rows aren't in the DB yet, so reserve as we go.
    taken.add(pickedPath);
    resolved.set(entry.tempId, { name: pickedName, path: pickedPath });
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// All-Documents (Folder) bulk creator
// ---------------------------------------------------------------------------

export async function bulkCreateMainDocsFolders(args: {
  tx: Prisma.TransactionClient;
  teamId: string;
  /** Absolute path (with leading "/") of the parent folder. */
  rootPath: string;
  /** Database id of the parent folder, or null for team-root. */
  rootParentId: string | null;
  folders: BulkFolderInput[];
}): Promise<BulkFolderResult[]> {
  const { tx, teamId, rootPath, rootParentId, folders } = args;
  const levels = buildLevels(folders);
  if (levels.length === 0) return [];

  const externalParentPathToId = await resolveExternalParentPaths(
    folders,
    (paths) =>
      tx.folder.findMany({
        where: { teamId, path: { in: paths } },
        select: { id: true, path: true },
      }),
  );

  const idByTemp = new Map<string, string>();
  const pathByTemp = new Map<string, string>();
  const nameByTemp = new Map<string, string>();
  const parentIdByTemp = new Map<string, string | null>();

  for (let depth = 0; depth < levels.length; depth++) {
    const level = levels[depth];

    // Re-resolve and re-insert on P2002 so a concurrent bulk request that
    // commits a colliding path between our SELECT and INSERT doesn't 500.
    const { resolved, inserted } = await withUniqueConstraintRetry({
      tx,
      savepointName: `bulk_main_folder_lvl_${depth}`,
      attempt: async () => {
        const resolved = await resolveLevelPaths({
          level,
          parentPathOf: (f) => parentPathOf(f, pathByTemp, rootPath),
          findExisting: (candidatePaths) =>
            tx.folder.findMany({
              where: { teamId, path: { in: candidatePaths } },
              select: { path: true },
            }),
        });

        const insertRows = level.map((f) => {
          const r = resolved.get(f.tempId)!;
          const parentId = resolveParentId(
            f,
            idByTemp,
            externalParentPathToId,
            rootParentId,
          );
          return {
            name: r.name,
            path: r.path,
            parentId,
            teamId,
          };
        });

        const inserted = await tx.folder.createManyAndReturn({
          data: insertRows,
          select: { id: true, name: true, path: true, parentId: true },
        });

        return { resolved, inserted };
      },
    });

    // Match returned rows by path (unique within a team). Do not rely on
    // createManyAndReturn input/output ordering — it's not guaranteed across
    // all Prisma + Postgres combinations and a single reordering would
    // cascade into wrong parentId mappings on every subsequent level.
    const insertedByPath = new Map(inserted.map((r) => [r.path, r]));
    for (const f of level) {
      const r = resolved.get(f.tempId)!;
      const row = insertedByPath.get(r.path);
      if (!row) {
        throw new BulkValidationError(
          "INSERT_MISSING",
          `Insert returned no row for path ${r.path}`,
        );
      }
      idByTemp.set(f.tempId, row.id);
      pathByTemp.set(f.tempId, row.path);
      nameByTemp.set(f.tempId, row.name);
      parentIdByTemp.set(f.tempId, row.parentId);
    }
  }

  return folders.map((f) => ({
    tempId: f.tempId,
    id: idByTemp.get(f.tempId)!,
    name: nameByTemp.get(f.tempId)!,
    path: pathByTemp.get(f.tempId)!,
    parentId: parentIdByTemp.get(f.tempId) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Dataroom (DataroomFolder) bulk creator
// ---------------------------------------------------------------------------

/**
 * Shifts request-relative sibling positions past whatever already sits under
 * the request root, so an import appends instead of interleaving with items
 * the user arranged by hand. Only folders landing directly under `rootPath`
 * can have pre-existing siblings; everything deeper gets a parent this same
 * request creates.
 */
async function appendRootChildrenAfterExisting(args: {
  tx: Prisma.TransactionClient;
  dataroomId: string;
  rootParentId: string | null;
  folders: BulkFolderInput[];
}): Promise<BulkFolderInput[]> {
  const { tx, dataroomId, rootParentId, folders } = args;
  const isRootChild = (f: BulkFolderInput) => !f.parentTempId && !f.parentPath;

  if (!folders.some((f) => isRootChild(f) && f.orderIndex != null)) {
    return folders;
  }

  // Serialize sibling-order reads for this parent so concurrent imports cannot
  // compute the same offset. Held until the surrounding transaction commits,
  // covering the inserts that consume the offset below.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${`bulk-folder-order:${dataroomId}:${rootParentId ?? ""}`})
    )
  `;

  const [folderMax, documentMax] = await Promise.all([
    tx.dataroomFolder.aggregate({
      where: { dataroomId, parentId: rootParentId },
      _max: { orderIndex: true },
    }),
    tx.dataroomDocument.aggregate({
      where: { dataroomId, folderId: rootParentId },
      _max: { orderIndex: true },
    }),
  ]);
  const offset =
    Math.max(
      folderMax._max.orderIndex ?? -1,
      documentMax._max.orderIndex ?? -1,
    ) + 1;
  if (offset === 0) return folders;

  return folders.map((f) =>
    isRootChild(f) && f.orderIndex != null
      ? { ...f, orderIndex: f.orderIndex + offset }
      : f,
  );
}

export async function bulkCreateDataroomFolders(args: {
  tx: Prisma.TransactionClient;
  dataroomId: string;
  rootPath: string;
  rootParentId: string | null;
  folders: BulkFolderInput[];
}): Promise<BulkFolderResult[]> {
  const { tx, dataroomId, rootPath, rootParentId } = args;
  const folders = await appendRootChildrenAfterExisting({
    tx,
    dataroomId,
    rootParentId,
    folders: args.folders,
  });
  const levels = buildLevels(folders);
  if (levels.length === 0) return [];

  const externalParentPathToId = await resolveExternalParentPaths(
    folders,
    (paths) =>
      tx.dataroomFolder.findMany({
        where: { dataroomId, path: { in: paths } },
        select: { id: true, path: true },
      }),
  );

  const idByTemp = new Map<string, string>();
  const pathByTemp = new Map<string, string>();
  const nameByTemp = new Map<string, string>();
  const parentIdByTemp = new Map<string, string | null>();
  const allCreatedIds: string[] = [];

  for (let depth = 0; depth < levels.length; depth++) {
    const level = levels[depth];

    // Re-resolve and re-insert on P2002 so a concurrent bulk request that
    // commits a colliding path between our SELECT and INSERT doesn't 500.
    const { resolved, inserted } = await withUniqueConstraintRetry({
      tx,
      savepointName: `bulk_dataroom_folder_lvl_${depth}`,
      attempt: async () => {
        const resolved = await resolveLevelPaths({
          level,
          parentPathOf: (f) => parentPathOf(f, pathByTemp, rootPath),
          findExisting: (candidatePaths) =>
            tx.dataroomFolder.findMany({
              where: { dataroomId, path: { in: candidatePaths } },
              select: { path: true },
            }),
        });

        const insertRows = level.map((f) => {
          const r = resolved.get(f.tempId)!;
          const parentId = resolveParentId(
            f,
            idByTemp,
            externalParentPathToId,
            rootParentId,
          );
          // hierarchicalIndex stays null; it is recomputed in bulk via
          // /api/teams/.../datarooms/[id]/calculate-indexes.
          return {
            name: r.name,
            path: r.path,
            parentId,
            dataroomId,
            orderIndex: f.orderIndex ?? null,
          };
        });

        const inserted = await tx.dataroomFolder.createManyAndReturn({
          data: insertRows,
          select: { id: true, name: true, path: true, parentId: true },
        });

        return { resolved, inserted };
      },
    });

    // Match returned rows by path (unique within a dataroom). Do not rely on
    // createManyAndReturn ordering — see note in bulkCreateMainDocsFolders.
    const insertedByPath = new Map(inserted.map((r) => [r.path, r]));
    for (const f of level) {
      const r = resolved.get(f.tempId)!;
      const row = insertedByPath.get(r.path);
      if (!row) {
        throw new BulkValidationError(
          "INSERT_MISSING",
          `Insert returned no row for path ${r.path}`,
        );
      }
      idByTemp.set(f.tempId, row.id);
      pathByTemp.set(f.tempId, row.path);
      nameByTemp.set(f.tempId, row.name);
      parentIdByTemp.set(f.tempId, row.parentId);
      allCreatedIds.push(row.id);
    }
  }

  await applyDefaultPermissionsBulk({
    tx,
    dataroomId,
    rootParentId,
    newFolderIds: allCreatedIds,
  });

  return folders.map((f) => ({
    tempId: f.tempId,
    id: idByTemp.get(f.tempId)!,
    name: nameByTemp.get(f.tempId)!,
    path: pathByTemp.get(f.tempId)!,
    parentId: parentIdByTemp.get(f.tempId) ?? null,
  }));
}

/**
 * Bulk-applies default ACLs to all newly created folders.
 *
 * Every folder in a single drop share the same "first existing ancestor"
 * (the rootParentId, or the dataroom root). So instead of N permission-lookup
 * queries we do:
 *   - 1 read for dataroom + viewer groups + permission groups
 *   - 1 read each for parent's existing viewer/permission ACLs (only if
 *     inherit-from-parent and rootParentId is non-null)
 *   - 1 createMany per ACL table
 */
async function applyDefaultPermissionsBulk(args: {
  tx: Prisma.TransactionClient;
  dataroomId: string;
  rootParentId: string | null;
  newFolderIds: string[];
}): Promise<void> {
  const { tx, dataroomId, rootParentId, newFolderIds } = args;
  if (newFolderIds.length === 0) return;

  const [dataroom, viewerGroups, permissionGroups] = await Promise.all([
    tx.dataroom.findUnique({
      where: { id: dataroomId },
      select: {
        defaultPermissionStrategy: true,
        defaultGroupPermissionStrategy: true,
        defaultRootItemAccess: true,
        defaultGroupRootItemAccess: true,
      },
    }),
    tx.viewerGroup.findMany({
      where: { dataroomId },
      select: { id: true },
    }),
    tx.permissionGroup.findMany({
      where: { dataroomId },
      select: { id: true },
    }),
  ]);
  if (!dataroom) return;

  const groupInherits =
    dataroom.defaultGroupPermissionStrategy ===
    DefaultPermissionStrategy.INHERIT_FROM_PARENT;
  const linkInherits =
    dataroom.defaultPermissionStrategy ===
    DefaultPermissionStrategy.INHERIT_FROM_PARENT;

  const [parentViewerPerms, parentLinkPerms] = await Promise.all([
    groupInherits && rootParentId && viewerGroups.length > 0
      ? tx.viewerGroupAccessControls.findMany({
          where: {
            itemId: rootParentId,
            itemType: ItemType.DATAROOM_FOLDER,
          },
          select: { groupId: true, canView: true, canDownload: true },
        })
      : Promise.resolve(
          [] as { groupId: string; canView: boolean; canDownload: boolean }[],
        ),
    linkInherits && rootParentId && permissionGroups.length > 0
      ? tx.permissionGroupAccessControls.findMany({
          where: {
            itemId: rootParentId,
            itemType: ItemType.DATAROOM_FOLDER,
          },
          select: {
            groupId: true,
            canView: true,
            canDownload: true,
            canDownloadOriginal: true,
          },
        })
      : Promise.resolve(
          [] as {
            groupId: string;
            canView: boolean;
            canDownload: boolean;
            canDownloadOriginal: boolean;
          }[],
        ),
  ]);

  const groupRootFlags = resolveRootItemAccessFlags(
    dataroom.defaultGroupRootItemAccess,
  );
  const linkRootFlags = resolveRootItemAccessFlags(
    dataroom.defaultRootItemAccess,
  );

  // Viewer-group ACLs.
  if (groupInherits && viewerGroups.length > 0) {
    const sourcePerms = rootParentId
      ? parentViewerPerms
      : groupRootFlags
        ? viewerGroups.map((g) => ({
            groupId: g.id,
            canView: groupRootFlags.canView,
            canDownload: groupRootFlags.canDownload,
          }))
        : [];

    if (sourcePerms.length > 0) {
      const data = newFolderIds.flatMap((folderId) =>
        sourcePerms.map((p) => ({
          groupId: p.groupId,
          itemId: folderId,
          itemType: ItemType.DATAROOM_FOLDER,
          canView: p.canView,
          canDownload: p.canDownload,
        })),
      );
      if (data.length > 0) {
        await tx.viewerGroupAccessControls.createMany({
          data,
          skipDuplicates: true,
        });
      }
    }
  }

  // Permission-group (link) ACLs.
  if (linkInherits && permissionGroups.length > 0) {
    const sourcePerms = rootParentId
      ? parentLinkPerms
      : linkRootFlags
        ? permissionGroups.map((g) => ({
            groupId: g.id,
            canView: linkRootFlags.canView,
            canDownload: linkRootFlags.canDownload,
            canDownloadOriginal: false,
          }))
        : [];

    if (sourcePerms.length > 0) {
      const data = newFolderIds.flatMap((folderId) =>
        sourcePerms.map((p) => ({
          groupId: p.groupId,
          itemId: folderId,
          itemType: ItemType.DATAROOM_FOLDER,
          canView: p.canView,
          canDownload: p.canDownload,
          canDownloadOriginal: p.canDownloadOriginal,
        })),
      );
      if (data.length > 0) {
        await tx.permissionGroupAccessControls.createMany({
          data,
          skipDuplicates: true,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shared helpers re-exported for the single-folder endpoints
// ---------------------------------------------------------------------------

/**
 * Resolves a free folder slug under `parentPath` in a single DB call.
 *
 * Used by both the bulk and the single-folder endpoints to replace the
 * up-to-50 sequential `findUnique` collision loop.
 */
export async function resolveFreeFolderPath(args: {
  name: string;
  parentPath: string;
  findExisting: (candidatePaths: string[]) => Promise<{ path: string }[]>;
}): Promise<{ name: string; path: string }> {
  const { name, parentPath, findExisting } = args;
  // Mirror the EMPTY_NAME guard enforced by buildLevels so single-folder
  // callers can't slip a whitespace-only name past the slug resolver.
  if (!name || name.trim() === "") {
    throw new BulkValidationError("EMPTY_NAME", "Folder name cannot be empty");
  }
  const result = await resolveLevelPaths({
    level: [{ tempId: "_single", name, parentTempId: null }],
    parentPathOf: () => parentPath,
    findExisting,
  });
  return result.get("_single")!;
}

export { BulkValidationError };
