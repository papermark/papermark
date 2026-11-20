import ExcelJS from "exceljs";

// =============================================================================
// Dataroom folder import — server-side Excel template generation (exceljs).
//
// Mirrors ee/features/request-lists/lib/export-generator.ts and
// lib/dataroom/index-generator.ts: builds a styled .xlsx and returns
// { data, filename, mimeType } for a route handler to stream as a download.
// Parsing uploads stays on SheetJS (lib/folders/parse-folder-import.ts) — the
// same "exceljs writes, sheetjs reads" split the codebase already uses.
// =============================================================================

const MIME_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Columns the import parser understands (see parse-folder-import.ts aliases).
const IMPORT_COLUMNS = [
  { header: "Hierarchy", key: "hierarchy", width: 16 },
  { header: "Name", key: "name", width: 48 },
] as const;

// Example tree that demonstrates nesting via the outline codes.
const EXAMPLE_ROWS: [string, string][] = [
  ["1", "Legal"],
  ["1.1", "Corporate Documents"],
  ["1.2", "Contracts"],
  ["1.2.1", "Customer Contracts"],
  ["1.2.2", "Supplier Contracts"],
  ["2", "Financials"],
  ["2.1", "Statements"],
  ["2.1.1", "2023"],
  ["2.1.2", "2024"],
  ["3", "Commercial"],
];

const TITLE_STYLE = {
  fill: {
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: { argb: "FF4F81BD" },
  },
  font: { color: { argb: "FFFFFFFF" }, bold: true, size: 14 },
  alignment: { horizontal: "left" as const },
};

function safeFilename(suffix: string, generatedAt: Date): string {
  const date = generatedAt
    .toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
    .replace(/[^a-zA-Z0-9]/g, "_");
  return `folders_${suffix}_${date}.xlsx`;
}

/**
 * Build a blank folder-import template: two title rows, a styled header row,
 * and an example tree the user can overwrite. Returns { data, filename,
 * mimeType } for the route handler to stream.
 */
export async function generateFolderImportTemplate(): Promise<{
  data: Uint8Array<ArrayBuffer>;
  filename: string;
  mimeType: string;
}> {
  const generatedAt = new Date();
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Folders");

  worksheet.columns = IMPORT_COLUMNS.map((column) => ({ ...column }));

  // Insert title + subtitle + a spacer above the header row.
  worksheet.spliceRows(
    1,
    0,
    ["Dataroom folder import template"],
    ['Use dotted outline codes (1, 1.1, 1.2) to nest folders. "Name" is required.'],
    [],
  );

  worksheet.getRow(1).eachCell((cell) => {
    cell.style = TITLE_STYLE;
  });
  worksheet.getRow(2).eachCell((cell) => {
    cell.style = TITLE_STYLE;
  });

  const lastCol = worksheet.getColumn(IMPORT_COLUMNS.length).letter;
  worksheet.mergeCells(`A1:${lastCol}1`);
  worksheet.mergeCells(`A2:${lastCol}2`);

  const headerRow = worksheet.getRow(4);
  headerRow.font = { size: 11, bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFDCE6F1" },
  };
  headerRow.alignment = { horizontal: "left" };
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });

  for (const [hierarchy, name] of EXAMPLE_ROWS) {
    const row = worksheet.addRow([hierarchy, name]);
    row.font = { italic: true, color: { argb: "FF808080" } };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  // Copy into a Uint8Array backed by a plain ArrayBuffer so it is a valid
  // BodyInit for NextResponse / the Node response (see export-generator.ts).
  return {
    data: new Uint8Array(buffer as ArrayBuffer),
    filename: safeFilename("import_template", generatedAt),
    mimeType: MIME_XLSX,
  };
}
