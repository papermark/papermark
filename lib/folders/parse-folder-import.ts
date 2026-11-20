// =============================================================================
// Dataroom folder import — client-side Excel/CSV parsing (SheetJS).
//
// Turns a two-column sheet (a hierarchy/outline column + a folder name column)
// into a flat list of folders with parent references, ready to POST to the
// bulk folder endpoint. `xlsx` (SheetJS) is imported dynamically so it stays
// out of the main bundle until a user actually picks a file — the same split
// the request-list import (ee/features/request-lists/lib/excel.ts) uses.
// =============================================================================
import type { BulkFolderRequestItem } from "./create-folder";

/** A single folder parsed from the sheet, ready to preview and submit. */
export type ParsedFolderRow = {
  tempId: string;
  name: string;
  parentTempId: string | null;
  /** Depth in the tree (0 = top level). Used only for preview indentation. */
  depth: number;
  /** The original hierarchy/outline code (e.g. "1.2"), for preview display. */
  hierarchy: string;
  /**
   * Position among the folder's siblings, counting from 0 in the order the
   * rows appear in the sheet. This is the same unit the drag-to-reorder
   * endpoint writes to DataroomFolder.orderIndex, so imported folders end up
   * in the order the preview shows.
   */
  orderIndex: number;
};

/** A row we couldn't import (e.g. a hierarchy code with no folder name). */
export type SkippedFolderRow = {
  /** 1-based spreadsheet row number (matches what users see in Excel). */
  row: number;
  reason: string;
};

export type FolderParseResult = {
  rows: ParsedFolderRow[];
  skipped: SkippedFolderRow[];
};

/** Mirrors MAX_BULK_FOLDERS_PER_REQUEST in lib/folders/bulk-create.ts. */
export const MAX_IMPORT_FOLDERS = 500;

const MAX_FOLDER_NAME_LENGTH = 255;

// --- Header matching --------------------------------------------------------

const HEADER_ALIASES = {
  name: ["name", "folder", "folder name", "foldername", "title", "label"],
  hierarchy: [
    "hierarchy",
    "level",
    "outline",
    "index",
    "no",
    "no.",
    "number",
    "#",
    "id",
    "order",
    "structure",
  ],
} as const;

type ColumnIndex = { name: number; hierarchy: number };

function buildColumnIndex(headers: string[]): ColumnIndex {
  const normalized = headers.map((h) =>
    String(h ?? "")
      .trim()
      .toLowerCase(),
  );
  const find = (aliases: readonly string[]) =>
    normalized.findIndex((h) => aliases.includes(h));
  return {
    name: find(HEADER_ALIASES.name),
    hierarchy: find(HEADER_ALIASES.hierarchy),
  };
}

// --- Value coercion ---------------------------------------------------------

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/**
 * Normalize a hierarchy/outline code into canonical dotted segments.
 * Tolerates trailing separators and stray whitespace, and works for numeric
 * ("1.2.3") as well as alphanumeric ("A.1") outlines. Returns the segment
 * array; e.g. "1. 2 ." -> ["1", "2"].
 */
function hierarchySegments(raw: string): string[] {
  return raw
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

// --- Parse ------------------------------------------------------------------

/**
 * Parse an uploaded .xlsx/.xls/.csv into a folder tree.
 *
 * The sheet is expected to have a folder-name column and (optionally) a
 * hierarchy/outline column such as:
 *
 *   Hierarchy | Name
 *   1         | Legal
 *   1.1       | Contracts
 *   1.2       | Corporate
 *   2         | Financials
 *
 * A folder's parent is the row whose hierarchy code is the current code with
 * its last segment removed ("1.2" -> parent "1"). If an intermediate code is
 * missing we walk further up the outline, falling back to the top level. When
 * no hierarchy column is present every folder is created at the top level.
 */
export async function parseFoldersFromFile(
  file: File,
): Promise<FolderParseResult> {
  const XLSX = await import("xlsx");

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    cellDates: true,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("The file does not contain any sheets.");
  }
  const worksheet = workbook.Sheets[sheetName];

  // Keep blank rows so skipped-row numbers map back to spreadsheet coordinates.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    blankrows: true,
    defval: "",
  });

  // Tolerate a leading title/subtitle block (like our own template): find the
  // first row that actually contains a recognized "name" column header.
  const headerRowIndex = matrix.findIndex((raw) => {
    const cells = (raw as unknown[]).map((c) => cellToString(c));
    return buildColumnIndex(cells).name !== -1;
  });

  if (headerRowIndex === -1) {
    throw new Error(
      'Missing a "Name" column. Download the template for the expected format.',
    );
  }

  const headers = (matrix[headerRowIndex] as unknown[]).map((h) =>
    cellToString(h),
  );
  const columns = buildColumnIndex(headers);

  const dataRows = matrix.slice(headerRowIndex + 1);
  const contentRowCount = dataRows.reduce((count, raw) => {
    const cells = raw as unknown[];
    const name = columns.name === -1 ? "" : cellToString(cells[columns.name]);
    const hierarchy =
      columns.hierarchy === -1 ? "" : cellToString(cells[columns.hierarchy]);
    return name || hierarchy ? count + 1 : count;
  }, 0);
  if (contentRowCount === 0) {
    throw new Error(
      "No data rows found. Add a header row plus at least one folder.",
    );
  }
  if (contentRowCount > MAX_IMPORT_FOLDERS) {
    throw new Error(
      `File contains ${contentRowCount} rows. Maximum is ${MAX_IMPORT_FOLDERS}.`,
    );
  }

  type WorkingRow = {
    tempId: string;
    name: string;
    segments: string[];
    code: string;
  };

  const working: WorkingRow[] = [];
  const skipped: SkippedFolderRow[] = [];
  // First tempId seen for a given canonical hierarchy code, so children can
  // resolve their parent by code. Later duplicates are skipped.
  const tempIdByCode = new Map<string, string>();

  dataRows.forEach((raw, index) => {
    const cells = raw as unknown[];
    const at = (i: number) => (i === -1 ? "" : cellToString(cells[i]));

    const name = at(columns.name);
    const rawHierarchy = at(columns.hierarchy);
    // 1-based spreadsheet row: matrix is 0-based, data starts after the header.
    const spreadsheetRow = headerRowIndex + index + 2;

    if (!name) {
      // Flag rows that carry a hierarchy code but no folder name; ignore rows
      // that are entirely empty.
      if (rawHierarchy) {
        skipped.push({ row: spreadsheetRow, reason: "Missing folder name" });
      }
      return;
    }

    const segments = hierarchySegments(rawHierarchy);
    const code = segments.join(".");
    const tempId = `f${index}`;

    if (code) {
      if (tempIdByCode.has(code)) {
        skipped.push({
          row: spreadsheetRow,
          reason: `Duplicate hierarchy code "${code}"`,
        });
        return;
      }
      tempIdByCode.set(code, tempId);
    }

    working.push({
      tempId,
      name: name.slice(0, MAX_FOLDER_NAME_LENGTH),
      segments,
      code,
    });
  });

  const parentTempIdOf = (segments: string[]): string | null => {
    // Walk up the outline ("1.2.3" -> "1.2" -> "1") until we find a known
    // ancestor; fall back to the top level when none exists.
    for (let cut = segments.length - 1; cut >= 1; cut--) {
      const candidate = segments.slice(0, cut).join(".");
      const parent = tempIdByCode.get(candidate);
      if (parent) return parent;
    }
    return null;
  };

  const rowByTempId = new Map<string, ParsedFolderRow>();
  for (const row of working) {
    rowByTempId.set(row.tempId, {
      tempId: row.tempId,
      name: row.name,
      parentTempId: parentTempIdOf(row.segments),
      depth: 0,
      hierarchy: row.code,
      orderIndex: 0,
    });
  }

  const depthOf = (tempId: string, seen: Set<string>): number => {
    const row = rowByTempId.get(tempId);
    if (!row || row.parentTempId === null) return 0;
    if (seen.has(tempId)) return 0; // defensive: never loop on malformed input
    seen.add(tempId);
    return depthOf(row.parentTempId, seen) + 1;
  };
  for (const row of rowByTempId.values()) {
    row.depth = depthOf(row.tempId, new Set());
  }

  // Emit in pre-order so the preview reads like a tree while preserving the
  // original sibling order.
  const childrenByParent = new Map<string | null, ParsedFolderRow[]>();
  for (const row of working) {
    const parsed = rowByTempId.get(row.tempId)!;
    const bucket = childrenByParent.get(parsed.parentTempId) ?? [];
    parsed.orderIndex = bucket.length;
    bucket.push(parsed);
    childrenByParent.set(parsed.parentTempId, bucket);
  }

  const ordered: ParsedFolderRow[] = [];
  const visit = (parentTempId: string | null) => {
    for (const child of childrenByParent.get(parentTempId) ?? []) {
      ordered.push(child);
      visit(child.tempId);
    }
  };
  visit(null);

  return { rows: ordered, skipped };
}

/** Map preview rows to the payload the bulk folder endpoint expects. */
export function toBulkFolderItems(
  rows: ParsedFolderRow[],
): BulkFolderRequestItem[] {
  return rows.map((row) => ({
    tempId: row.tempId,
    name: row.name,
    parentTempId: row.parentTempId,
    orderIndex: row.orderIndex,
  }));
}
