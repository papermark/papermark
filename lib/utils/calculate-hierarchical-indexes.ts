import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

interface DataroomItem {
  id: string;
  name: string;
  orderIndex: number | null;
  parentId?: string | null;
  folderId?: string | null;
  type: "folder" | "document";
}

interface HierarchicalItem extends DataroomItem {
  hierarchicalIndex: string;
  children: HierarchicalItem[];
}

/**
 * Sorts items by orderIndex first (nulls last), then by name
 */
function sortItems(items: DataroomItem[]): DataroomItem[] {
  return items.sort((a, b) => {
    // First sort by orderIndex (nulls go to the end)
    if (a.orderIndex !== null && b.orderIndex !== null) {
      if (a.orderIndex !== b.orderIndex) {
        return a.orderIndex - b.orderIndex;
      }
    } else if (a.orderIndex !== null) {
      return -1; // a comes first
    } else if (b.orderIndex !== null) {
      return 1; // b comes first
    }

    // Then sort by name
    return a.name.localeCompare(b.name);
  });
}

/**
 * Builds a hierarchical tree structure from flat items.
 *
 * Children are indexed by parent id once (O(n)) so we avoid re-scanning the
 * full item list for every node — important for large datarooms (thousands of
 * documents) where the previous O(n²) filtering became a bottleneck. Only
 * folders can have children; documents are always leaves.
 */
function buildHierarchy(items: DataroomItem[]): HierarchicalItem[] {
  const childrenByParent = new Map<string | null, DataroomItem[]>();
  for (const item of items) {
    const parentKey =
      (item.type === "folder" ? item.parentId : item.folderId) ?? null;
    const siblings = childrenByParent.get(parentKey);
    if (siblings) {
      siblings.push(item);
    } else {
      childrenByParent.set(parentKey, [item]);
    }
  }

  const build = (parentId: string | null): HierarchicalItem[] => {
    const children = childrenByParent.get(parentId) ?? [];
    const sortedChildren = sortItems(children);

    return sortedChildren.map((item) => ({
      ...item,
      hierarchicalIndex: "", // Will be set later
      children: item.type === "folder" ? build(item.id) : [],
    }));
  };

  return build(null);
}

/**
 * Assigns hierarchical indexes to items recursively
 */
function assignHierarchicalIndexes(
  items: HierarchicalItem[],
  prefix: string = "",
): void {
  items.forEach((item, index) => {
    const currentIndex = index + 1;
    item.hierarchicalIndex = prefix
      ? `${prefix}.${currentIndex}`
      : `${currentIndex}`;

    if (item.children.length > 0) {
      assignHierarchicalIndexes(item.children, item.hierarchicalIndex);
    }
  });
}

/**
 * Flattens the hierarchical tree back to a flat array with hierarchical indexes
 */
function flattenHierarchy(items: HierarchicalItem[]): Array<{
  id: string;
  hierarchicalIndex: string;
  type: "folder" | "document";
}> {
  const result: Array<{
    id: string;
    hierarchicalIndex: string;
    type: "folder" | "document";
  }> = [];

  items.forEach((item) => {
    result.push({
      id: item.id,
      hierarchicalIndex: item.hierarchicalIndex,
      type: item.type,
    });

    if (item.children.length > 0) {
      result.push(...flattenHierarchy(item.children));
    }
  });

  return result;
}

/**
 * Calculates and updates hierarchical indexes for all folders and documents in a dataroom
 */
export async function calculateAndUpdateHierarchicalIndexes(
  dataroomId: string,
): Promise<{ foldersUpdated: number; documentsUpdated: number }> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Consistent snapshot of folders and documents
        const folders = await tx.dataroomFolder.findMany({
          where: { dataroomId },
          select: {
            id: true,
            name: true,
            parentId: true,
            orderIndex: true,
          },
        });
        const documents = await tx.dataroomDocument.findMany({
          where: { dataroomId },
          select: {
            id: true,
            folderId: true,
            orderIndex: true,
            document: {
              select: {
                name: true,
              },
            },
          },
        });

        // Convert to unified format
        const allItems: DataroomItem[] = [
          ...folders.map((folder) => ({
            id: folder.id,
            name: folder.name,
            orderIndex: folder.orderIndex,
            parentId: folder.parentId,
            type: "folder" as const,
          })),
          ...documents.map((doc) => ({
            id: doc.id,
            name: doc.document.name,
            orderIndex: doc.orderIndex,
            folderId: doc.folderId,
            type: "document" as const,
          })),
        ];

        // Build hierarchy starting from root items (no parent)
        const hierarchy = buildHierarchy(allItems);

        // Assign hierarchical indexes
        assignHierarchicalIndexes(hierarchy);

        // Flatten back to get all items with their indexes
        const flattenedItems = flattenHierarchy(hierarchy);

        // Separate folders and documents for batch updates
        const folderUpdates = flattenedItems.filter(
          (item) => item.type === "folder",
        );
        const documentUpdates = flattenedItems.filter(
          (item) => item.type === "document",
        );

        // Apply all index changes with a single bulk UPDATE per chunk instead
        // of one round-trip per row. Issuing hundreds of sequential `update`
        // calls inside an interactive transaction routinely blows past
        // Prisma's default 5s transaction timeout (P2028) on larger datarooms.
        const CHUNK = 500;

        const bulkUpdateIndexes = async (
          table: Prisma.Sql,
          rows: Array<{ id: string; hierarchicalIndex: string }>,
        ) => {
          for (let i = 0; i < rows.length; i += CHUNK) {
            const chunk = rows.slice(i, i + CHUNK);
            const values = Prisma.join(
              chunk.map((r) => Prisma.sql`(${r.id}, ${r.hierarchicalIndex})`),
            );
            await tx.$executeRaw`
              UPDATE ${table} AS t
              SET "hierarchicalIndex" = data.idx::text, "updatedAt" = NOW()
              FROM (VALUES ${values}) AS data(id, idx)
              WHERE t.id = data.id::text
            `;
          }
        };

        await bulkUpdateIndexes(Prisma.sql`"DataroomFolder"`, folderUpdates);
        await bulkUpdateIndexes(
          Prisma.sql`"DataroomDocument"`,
          documentUpdates,
        );

        return {
          foldersUpdated: folderUpdates.length,
          documentsUpdated: documentUpdates.length,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 10_000,
        timeout: 120_000,
      },
    );
  } catch (error) {
    console.error(
      "Error calculating hierarchical indexes for",
      dataroomId,
      error,
    );
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(
      `Failed to calculate and update hierarchical indexes: ${message}`,
      { cause: error },
    );
  }
}

/**
 * Clears (removes) hierarchical indexes for all folders and documents in a dataroom
 * by setting their `hierarchicalIndex` back to null.
 */
export async function clearHierarchicalIndexes(
  dataroomId: string,
): Promise<{ foldersUpdated: number; documentsUpdated: number }> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const foldersResult = await tx.dataroomFolder.updateMany({
          where: { dataroomId, hierarchicalIndex: { not: null } },
          data: { hierarchicalIndex: null },
        });
        const documentsResult = await tx.dataroomDocument.updateMany({
          where: { dataroomId, hierarchicalIndex: { not: null } },
          data: { hierarchicalIndex: null },
        });

        return {
          foldersUpdated: foldersResult.count,
          documentsUpdated: documentsResult.count,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch (error) {
    console.error("Error clearing hierarchical indexes for", dataroomId, error);
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to clear hierarchical indexes: ${message}`, {
      cause: error,
    });
  }
}
