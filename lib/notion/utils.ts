import { NotionAPI } from "notion-client";
import { Block, ExtendedRecordMap } from "notion-types";
import { getPageContentBlockIds, parsePageId } from "notion-utils";

import notion from "./index";

/**
 * Extracts all page reference IDs from rich text decorations in the recordMap.
 * This handles the "p" decorator which is used for page mentions/links.
 */
function extractPageReferencesFromRichText(
  value: any[] | undefined,
): string[] {
  if (!value || !Array.isArray(value)) return [];

  const pageIds: string[] = [];

  for (const segment of value) {
    if (!Array.isArray(segment)) continue;

    const decorations = segment[1];
    if (!decorations || !Array.isArray(decorations)) continue;

    for (const decoration of decorations) {
      if (!Array.isArray(decoration)) continue;

      // "p" decorator indicates a page reference
      if (decoration[0] === "p" && decoration[1]) {
        pageIds.push(decoration[1]);
      }

      // "‣" (U+2023) decorator can also reference pages
      if (decoration[0] === "\u2023" && Array.isArray(decoration[1])) {
        const [linkType, id] = decoration[1];
        // Skip user references ("u"), only handle page references
        if (linkType !== "u" && id) {
          pageIds.push(id);
        }
      }
    }
  }

  return pageIds;
}

/**
 * Normalizes the block entries in a recordMap to ensure a consistent structure.
 *
 * The Notion API (via `getBlocks` / newer API responses) sometimes returns blocks
 * in a double-nested format:
 *   { spaceId, value: { value: { id, type, ... }, role: "reader" } }
 *
 * But `react-notion-x` expects:
 *   { value: { id, type, ... }, role: "reader" }
 *
 * This function flattens any double-nested entries so the renderer doesn't crash
 * when calling `uuidToId` on an undefined block id.
 */
export function normalizeRecordMap(recordMap: ExtendedRecordMap): void {
  // Normalize blocks
  for (const blockId of Object.keys(recordMap.block)) {
    const entry = recordMap.block[blockId] as any;
    if (
      entry?.value &&
      typeof entry.value === "object" &&
      entry.value.value &&
      typeof entry.value.value === "object" &&
      entry.value.value.id
    ) {
      // Double-nested: flatten { value: { value: {...}, role }, spaceId } → { value: {...}, role }
      recordMap.block[blockId] = {
        value: entry.value.value,
        role: entry.value.role ?? entry.role ?? "reader",
      } as any;
    }
  }

  // Normalize collections (same pattern can occur)
  if (recordMap.collection) {
    for (const collectionId of Object.keys(recordMap.collection)) {
      const entry = recordMap.collection[collectionId] as any;
      if (
        entry?.value &&
        typeof entry.value === "object" &&
        entry.value.value &&
        typeof entry.value.value === "object" &&
        entry.value.value.id
      ) {
        recordMap.collection[collectionId] = {
          value: entry.value.value,
          role: entry.value.role ?? entry.role ?? "reader",
        } as any;
      }
    }
  }
}

/**
 * Fetches missing page blocks that are referenced in rich text or as alias
 * targets but not present in the recordMap.
 */
export async function fetchMissingPageReferences(
  recordMap: ExtendedRecordMap,
): Promise<void> {
  normalizeRecordMap(recordMap);

  const allPageReferenceIds = new Set<string>();

  for (const blockId of Object.keys(recordMap.block)) {
    const block = recordMap.block[blockId]?.value as any;
    if (!block) continue;

    // Collect page references from rich text properties
    if (block.properties) {
      for (const propKey of Object.keys(block.properties)) {
        const propValue = block.properties[propKey];
        const pageIds = extractPageReferencesFromRichText(propValue);
        pageIds.forEach((id) => allPageReferenceIds.add(id));
      }
    }

    // Collect alias (link-to-page) targets
    if (block.type === "alias" && block.format?.alias_pointer?.id) {
      allPageReferenceIds.add(block.format.alias_pointer.id);
    }

    // Collect child page references from content array
    if (block.content && Array.isArray(block.content)) {
      for (const childId of block.content) {
        if (typeof childId === "string" && !recordMap.block[childId]) {
          allPageReferenceIds.add(childId);
        }
      }
    }
  }

  const missingPageIds = Array.from(allPageReferenceIds).filter(
    (id) => !recordMap.block[id],
  );

  if (missingPageIds.length === 0) return;

  try {
    const newBlocks = await notion.getBlocks(missingPageIds);
    if (newBlocks?.recordMap?.block) {
      recordMap.block = {
        ...recordMap.block,
        ...newBlocks.recordMap.block,
      };
    }
    normalizeRecordMap(recordMap);
  } catch (err) {
    console.warn("Failed to fetch missing page references:", err);
  }
}

export const addSignedUrls: NotionAPI["addSignedUrls"] = async ({
  recordMap,
  contentBlockIds,
}) => {
  recordMap.signed_urls = {};

  if (!contentBlockIds) {
    contentBlockIds = getPageContentBlockIds(recordMap);
  }

  const allFileInstances = contentBlockIds.flatMap((blockId) => {
    const block = recordMap.block[blockId]?.value as Block | undefined;

    if (
      block &&
      (block.type === "pdf" ||
        block.type === "audio" ||
        (block.type === "image" && block.file_ids?.length) ||
        block.type === "video" ||
        block.type === "file" ||
        block.type === "page")
    ) {
      const source =
        block.type === "page"
          ? block.format?.page_cover
          : block.properties?.source?.[0]?.[0];

      if (source) {
        if (
          source.includes("secure.notion-static.com") ||
          source.includes("prod-files-secure") ||
          source.includes("attachment:")
        ) {
          return {
            permissionRecord: {
              table: "block",
              id: block.id,
            },
            url: source,
          };
        }
      }
    }

    return [];
  });

  if (allFileInstances.length > 0) {
    try {
      const { signedUrls } = await notion.getSignedFileUrls(allFileInstances);

      if (signedUrls.length === allFileInstances.length) {
        for (const [i, file] of allFileInstances.entries()) {
          const signedUrl = signedUrls[i];
          if (!signedUrl) continue;

          const blockId = file.permissionRecord.id;
          if (!blockId) continue;

          recordMap.signed_urls[blockId] = signedUrl;
        }
      }
    } catch (err) {
      console.warn("NotionAPI getSignedfileUrls error", err);
    }
  }
};

/**
 * Extracts page ID from custom Notion domain URLs
 * For custom domains, the page ID is typically embedded in the URL slug
 */
export function extractPageIdFromCustomNotionUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Try robust parser first (handles hyphenated and plain IDs)
    const parsed = parsePageId(url) || parsePageId(pathname);
    if (parsed) return parsed;

    // Fallback: match either plain 32-hex or hyphenated UUID-like Notion ID
    const pageIdMatch = pathname.match(
      /\b(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/i,
    );
    if (pageIdMatch) return parsePageId(pageIdMatch[0]) ?? pageIdMatch[0];

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a URL is potentially a custom Notion domain by attempting to extract a page ID
 * and verifying the page exists
 */
export async function isCustomNotionDomain(url: string): Promise<boolean> {
  try {
    const pageId = extractPageIdFromCustomNotionUrl(url);
    if (!pageId) {
      return false;
    }

    // Try to fetch the page to verify it exists and is accessible
    await notion.getPage(pageId);
    return true;
  } catch {
    return false;
  }
}

export async function getNotionPageIdFromSlug(
  url: string,
): Promise<string | null> {
  // Parse the URL to extract domain and slug
  const urlObj = new URL(url);
  const hostname = urlObj.hostname;

  const isNotionSo = hostname === "www.notion.so" || hostname === "notion.so";
  const isNotionSite = hostname.endsWith(".notion.site");

  // notion.so: extract ID from path directly
  if (isNotionSo) {
    const pageId = parsePageId(url) ?? parsePageId(urlObj.pathname);
    if (pageId) return pageId;
    throw new Error(`Unable to extract page ID from Notion URL: ${url}`);
  }

  // Custom domains (non notion.site, non notion.so)
  if (!isNotionSite) {
    const pageId = extractPageIdFromCustomNotionUrl(url);
    if (pageId) {
      // Verify the page exists before returning the ID
      try {
        await notion.getPage(pageId);
        return pageId;
      } catch {
        throw new Error(`Custom Notion domain page not accessible: ${url}`);
      }
    }
    throw new Error(`Unable to extract page ID from custom domain URL: ${url}`);
  }

  // Extract domain from hostname (e.g., "domain" from "domain.notion.site")
  const domainMatch = hostname.match(/^([^.]+)\.notion\.site$/);
  if (!domainMatch) {
    throw new Error(`Invalid Notion site URL format: ${url}`);
  }

  const spaceDomain = domainMatch[1];

  // Extract slug from pathname (remove leading slash)
  // If slug is missing, we will try to get page just by using spaceDomain
  let slug = urlObj.pathname.substring(1) || "";

  // Make request to Notion's internal API
  const apiUrl = `https://${spaceDomain}.notion.site/api/v3/getPublicPageDataForDomain`;
  const payload = {
    type: "block-space",
    name: "page",
    slug: slug,
    spaceDomain: spaceDomain,
    requestedOnPublicDomain: true,
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; MyApp/1.0)",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `Notion API request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();

  if (data.pageId) {
    return data.pageId;
  } else {
    throw new Error("No pageId found in Notion API response");
  }
}
