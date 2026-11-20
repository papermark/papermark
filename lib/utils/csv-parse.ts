/**
 * Lightweight RFC4180-compliant CSV parser used for bulk import flows.
 * Keeps the bundle slim by avoiding a third-party dependency.
 */
export type CsvRow = Record<string, string>;

export interface ParsedCsv {
  headers: string[];
  rows: CsvRow[];
}

/**
 * Parses CSV text into a list of header keys and trimmed row records. Handles
 * quoted values, escaped quotes (""), CR/LF line endings, and a trailing
 * newline. Empty rows are skipped.
 */
export function parseCsv(text: string): ParsedCsv {
  // Strip BOM if present – Excel exports often include it.
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n" || char === "\r") {
      // Handle CRLF: skip the LF that may follow a CR
      if (char === "\r" && text[i + 1] === "\n") {
        i++;
      }
      row.push(field);
      field = "";
      records.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  // Flush any remaining field/row from a file with no trailing newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = records[0].map((h) => h.trim());
  const rows: CsvRow[] = [];

  for (let r = 1; r < records.length; r++) {
    const cols = records[r];
    // Skip blank lines (a single empty cell).
    const isEmpty =
      cols.length === 0 || (cols.length === 1 && cols[0].trim() === "");
    if (isEmpty) continue;

    const record: CsvRow = {};
    for (let c = 0; c < headers.length; c++) {
      const value = (cols[c] ?? "").trim();
      record[headers[c]] = value;
    }
    rows.push(record);
  }

  return { headers, rows };
}

/**
 * Coerces common "boolean-ish" strings produced by spreadsheet exports.
 * Returns undefined when the value is empty/whitespace, allowing the caller
 * to distinguish "not provided" from "false".
 */
export function parseCsvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "") return undefined;
  if (["true", "yes", "y", "1", "on"].includes(v)) return true;
  if (["false", "no", "n", "0", "off"].includes(v)) return false;
  return undefined;
}

/**
 * Parses a delimited list inside a single CSV cell. Supports semicolons,
 * pipes, and newlines so users can paste pre-formatted lists.
 */
export function parseCsvList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return trimmed
    .split(/[;|\n]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Quote a single CSV field per RFC 4180 when it contains a delimiter, quote,
 * or line break. Plain values are returned unmodified to keep output compact.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str =
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.join(";")
        : typeof value === "boolean" || typeof value === "number"
          ? String(value)
          : String(value);

  // Neutralize spreadsheet formula injection: prefix risky leading chars
  // with a single quote so Excel/Sheets treats the cell as literal text.
  if (str.length > 0 && /^[=+\-@]/.test(str)) {
    str = "'" + str;
  }

  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialise an array of records into a CSV string with the supplied header
 * order. Missing fields render as empty cells. Uses CRLF line endings for
 * maximum compatibility with Excel.
 */
export function stringifyCsv(
  headers: string[],
  rows: Array<Record<string, unknown>>,
): string {
  const lines = [headers.map(escapeCsvField).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvField(row[h])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
