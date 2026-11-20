import { SYSTEM_FILES } from "../constants";

export function isSystemFile(name: string): boolean {
  return (
    SYSTEM_FILES.includes(name.toLowerCase()) ||
    name.toLowerCase().startsWith(".")
  );
}

interface CreateFolderResponse {
  id: string;
  path: string;
  parentFolderPath?: string;
  name: string;
}

export interface BulkFolderRequestItem {
  tempId: string;
  name: string;
  parentTempId?: string | null;
  /**
   * Server-resolved path of an existing parent — only used by the chunked
   * helper when a folder's parent was created in a prior chunk. The server
   * looks this path up in DB to resolve the parent's id.
   */
  parentPath?: string | null;
  /**
   * Position among the folder's siblings within this request, counting from
   * 0. The dataroom bulk endpoint shifts these past whatever already sits
   * under the parent and stores the result as orderIndex. Omitted/null leaves
   * orderIndex null, which sorts the folder after every numbered sibling.
   */
  orderIndex?: number | null;
}

export interface BulkFolderResultItem {
  tempId: string;
  id: string;
  name: string;
  path: string;
  parentId: string | null;
}

/**
 * Thrown by `bulkCreateFoldersChunked` when a chunk fails after one or more
 * earlier chunks have already committed. Each chunk is its own server-side
 * transaction, so the rows in `created` are guaranteed to exist in the DB —
 * callers that want partial-success semantics should consume them instead of
 * treating every input folder as failed.
 */
export class BulkCreateFoldersChunkedError extends Error {
  readonly created: BulkFolderResultItem[];
  readonly failedChunkIndex: number;

  constructor(
    message: string,
    opts: {
      created: BulkFolderResultItem[];
      failedChunkIndex: number;
      cause?: unknown;
    },
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "BulkCreateFoldersChunkedError";
    this.created = opts.created;
    this.failedChunkIndex = opts.failedChunkIndex;
  }
}

/**
 * Server cap on a single bulk request. Mirrors MAX_BULK_FOLDERS_PER_REQUEST
 * in lib/folders/bulk-create.ts (not imported because that module pulls in
 * Prisma and isn't safe to use in client bundles).
 */
const BULK_CHUNK_SIZE = 500;

/**
 * POSTs the entire folder tree to the bulk endpoint and returns the created
 * rows keyed by tempId. Empty input is a no-op. Caller must ensure the input
 * size is <= BULK_CHUNK_SIZE — use bulkCreateFoldersChunked for arbitrary
 * sizes.
 */
export async function bulkCreateFolders(args: {
  url: string;
  rootPath?: string;
  folders: BulkFolderRequestItem[];
}): Promise<BulkFolderResultItem[]> {
  if (args.folders.length === 0) return [];
  const response = await fetch(args.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rootPath: args.rootPath, folders: args.folders }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as { message?: string });
    throw new Error(body.message || `Bulk folder create failed (${response.status})`);
  }
  const data = (await response.json()) as { folders: BulkFolderResultItem[] };
  return data.folders;
}

/**
 * Bulk-create that transparently splits arbitrarily large folder trees into
 * server-sized chunks (BULK_CHUNK_SIZE). Each chunk is one POST; chunks run
 * sequentially because chunk N+1 may reference parents resolved in chunk N
 * via `parentPath`.
 *
 * Strategy:
 *   1. Topologically sort by parentTempId depth (shallowest first), so any
 *      cross-chunk reference is always backwards.
 *   2. Pack greedily into chunks of <= BULK_CHUNK_SIZE.
 *   3. Before sending each chunk: for any folder whose parentTempId points
 *      to a prior chunk, swap parentTempId out for the parent's resolved
 *      `parentPath` (the server resolves it via DB lookup in one query).
 *
 * Failure semantics: each chunk is its own DB transaction. If chunk K
 * fails, chunks 1..K-1 have already committed. Callers should treat this as
 * partial success and report which folders never made it.
 */
export async function bulkCreateFoldersChunked(args: {
  url: string;
  rootPath?: string;
  folders: BulkFolderRequestItem[];
}): Promise<BulkFolderResultItem[]> {
  if (args.folders.length === 0) return [];
  if (args.folders.length <= BULK_CHUNK_SIZE) {
    return bulkCreateFolders(args);
  }

  const byTemp = new Map(args.folders.map((f) => [f.tempId, f]));
  const depthCache = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (f: BulkFolderRequestItem): number => {
    const cached = depthCache.get(f.tempId);
    if (cached !== undefined) return cached;
    if (visiting.has(f.tempId)) {
      throw new Error(
        `Cycle detected in folder parentTempId graph at ${f.tempId}`,
      );
    }
    if (!f.parentTempId) {
      depthCache.set(f.tempId, 0);
      return 0;
    }
    const parent = byTemp.get(f.parentTempId);
    if (!parent) {
      // External parent (parentPath or rootPath) — same depth as a root.
      depthCache.set(f.tempId, 0);
      return 0;
    }
    visiting.add(f.tempId);
    try {
      const d = depthOf(parent) + 1;
      depthCache.set(f.tempId, d);
      return d;
    } finally {
      visiting.delete(f.tempId);
    }
  };
  const sorted = [...args.folders].sort(
    (a, b) => depthOf(a) - depthOf(b),
  );

  const resolvedByTemp = new Map<string, BulkFolderResultItem>();
  const allResults: BulkFolderResultItem[] = [];

  for (let i = 0; i < sorted.length; i += BULK_CHUNK_SIZE) {
    const chunkIndex = i / BULK_CHUNK_SIZE;
    const chunk = sorted.slice(i, i + BULK_CHUNK_SIZE);
    const chunkTempIds = new Set(chunk.map((f) => f.tempId));
    const rewritten = chunk.map((f): BulkFolderRequestItem => {
      if (f.parentTempId && !chunkTempIds.has(f.parentTempId)) {
        const parent = resolvedByTemp.get(f.parentTempId);
        if (!parent) {
          throw new BulkCreateFoldersChunkedError(
            `Bulk chunk references unresolved parent ${f.parentTempId}`,
            { created: allResults, failedChunkIndex: chunkIndex },
          );
        }
        return {
          tempId: f.tempId,
          name: f.name,
          parentTempId: null,
          parentPath: parent.path,
          orderIndex: f.orderIndex,
        };
      }
      return f;
    });

    let chunkResult: BulkFolderResultItem[];
    try {
      chunkResult = await bulkCreateFolders({
        url: args.url,
        rootPath: args.rootPath,
        folders: rewritten,
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : `Bulk folder chunk ${chunkIndex} failed`;
      throw new BulkCreateFoldersChunkedError(message, {
        created: allResults,
        failedChunkIndex: chunkIndex,
        cause: err,
      });
    }
    for (const row of chunkResult) {
      resolvedByTemp.set(row.tempId, row);
      allResults.push(row);
    }
  }

  return allResults;
}

export async function createFolderInMainDocs({
  teamId,
  name,
  path,
}: {
  teamId: string;
  name: string;
  path?: string;
}): Promise<CreateFolderResponse> {
  const response = await fetch(`/api/teams/${teamId}/folders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      path,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.message || "Failed to create folder in all documents",
    );
  }

  return response.json();
}
