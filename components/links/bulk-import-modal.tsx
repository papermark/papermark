import { useCallback, useMemo, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CopyIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
  UploadCloudIcon,
} from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import { useAnalytics } from "@/lib/analytics";
import useLimits from "@/lib/swr/use-limits";
import { copyToClipboard } from "@/lib/utils";
import {
  parseCsv,
  parseCsvBoolean,
  parseCsvList,
  stringifyCsv,
} from "@/lib/utils/csv-parse";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
const MAX_ROWS = 500;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

const TEMPLATE_HEADERS = [
  "name",
  "domain",
  "slug",
  "password",
  "expiresAt",
  "emailProtected",
  "emailAuthenticated",
  "allowDownload",
  "enableNotification",
  "enableScreenshotProtection",
  "enableConfidentialView",
  "showBanner",
  "allowList",
  "denyList",
  "presetId",
] as const;

const TEMPLATE_EXAMPLE_ROW = [
  "Acme Corp",
  "",
  "",
  "",
  "2025-12-31T23:59:00Z",
  "true",
  "false",
  "true",
  "true",
  "false",
  "false",
  "alice@acme.com;bob@acme.com",
  "",
  "",
];

type LinkPayload = {
  name?: string;
  domain?: string;
  slug?: string;
  password?: string;
  expiresAt?: string;
  emailProtected?: boolean;
  emailAuthenticated?: boolean;
  allowDownload?: boolean;
  enableNotification?: boolean;
  enableScreenshotProtection?: boolean;
  enableConfidentialView?: boolean;
  showBanner?: boolean;
  allowList?: string[];
  denyList?: string[];
  presetId?: string;
};

interface BulkResult {
  row: number;
  name?: string;
  status: "success" | "error";
  linkId?: string;
  linkUrl?: string;
  error?: string;
}

interface BulkResponse {
  summary: { total: number; success: number; failed: number };
  results: BulkResult[];
}

const BOOLEAN_FIELDS: Array<keyof LinkPayload> = [
  "emailProtected",
  "emailAuthenticated",
  "allowDownload",
  "enableNotification",
  "enableScreenshotProtection",
  "enableConfidentialView",
  "showBanner",
];

const LIST_FIELDS: Array<keyof LinkPayload> = ["allowList", "denyList"];
const STRING_FIELDS: Array<keyof LinkPayload> = [
  "name",
  "domain",
  "slug",
  "password",
  "expiresAt",
  "presetId",
];

function buildTemplateCsv(): string {
  const rows = [TEMPLATE_HEADERS.join(","), TEMPLATE_EXAMPLE_ROW.join(",")];
  return rows.join("\n") + "\n";
}

function downloadTemplate() {
  const blob = new Blob([buildTemplateCsv()], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", "papermark-bulk-links-template.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function rowToPayload(row: Record<string, string>): LinkPayload {
  const payload: LinkPayload = {};

  for (const field of STRING_FIELDS) {
    const raw = row[field];
    if (raw && raw.trim().length > 0) {
      (payload as any)[field] = raw.trim();
    }
  }

  for (const field of BOOLEAN_FIELDS) {
    const parsed = parseCsvBoolean(row[field]);
    if (parsed !== undefined) {
      (payload as any)[field] = parsed;
    }
  }

  for (const field of LIST_FIELDS) {
    const parsed = parseCsvList(row[field]);
    if (parsed !== undefined) {
      (payload as any)[field] = parsed;
    }
  }

  return payload;
}

export function BulkImportLinksModal({
  isOpen,
  setIsOpen,
  targetType,
  targetId,
  onImported,
}: {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  targetType: "DOCUMENT" | "DATAROOM";
  targetId: string;
  onImported?: () => void;
}) {
  const { currentTeamId } = useTeam();
  const { limits, canAddLinks } = useLimits();
  const analytics = useAnalytics();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<LinkPayload[]>([]);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [response, setResponse] = useState<BulkResponse | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const linkType = useMemo<"DOCUMENT_LINK" | "DATAROOM_LINK">(
    () => (targetType === "DATAROOM" ? "DATAROOM_LINK" : "DOCUMENT_LINK"),
    [targetType],
  );
  const endpointTargetType = targetType === "DATAROOM" ? "datarooms" : "documents";

  const remainingLinks = useMemo<number | null>(() => {
    const linkLimit = limits?.links;
    if (
      linkLimit === undefined ||
      linkLimit === null ||
      !Number.isFinite(linkLimit)
    ) {
      return null;
    }
    const used = limits?.usage?.links ?? 0;
    return Math.max(0, (linkLimit as number) - used);
  }, [limits]);

  const exceedsLimit =
    remainingLinks !== null && parsedRows.length > remainingLinks;

  const reset = useCallback(() => {
    setFileName(null);
    setParsedRows([]);
    setRawHeaders([]);
    setRawRows([]);
    setParseError(null);
    setResponse(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleClose = useCallback(
    (open: boolean) => {
      if (!open) {
        reset();
      }
      setIsOpen(open);
    },
    [reset, setIsOpen],
  );

  const handleFileSelected = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      setParseError(null);
      setResponse(null);

      if (file.size > MAX_FILE_SIZE_BYTES) {
        setParseError(
          "CSV is larger than 2 MB. Please split into smaller files.",
        );
        return;
      }

      try {
        const text = await file.text();
        const { headers, rows } = parseCsv(text);

        if (rows.length === 0) {
          setParseError("CSV does not contain any data rows.");
          setParsedRows([]);
          return;
        }

        if (rows.length > MAX_ROWS) {
          setParseError(
            `CSV contains ${rows.length} rows. Maximum is ${MAX_ROWS}.`,
          );
          setParsedRows([]);
          return;
        }

        const unknownHeaders = headers.filter(
          (h) => h && !TEMPLATE_HEADERS.includes(h as any),
        );
        if (unknownHeaders.length > 0) {
          // Surface as a soft warning – we still parse what we recognize.
          toast.message(
            `Ignoring unknown column${unknownHeaders.length > 1 ? "s" : ""}: ${unknownHeaders.join(", ")}`,
          );
        }

        setParsedRows(rows.map(rowToPayload));
        setRawHeaders(headers);
        setRawRows(rows);
        setFileName(file.name);
      } catch (error) {
        console.error(error);
        setParseError(
          error instanceof Error
            ? error.message
            : "Failed to read CSV. Please check the file format.",
        );
      }
    },
    [],
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);

      const file = event.dataTransfer?.files?.[0];
      if (!file) return;

      const isCsv =
        file.type === "text/csv" ||
        file.type === "application/vnd.ms-excel" ||
        file.name.toLowerCase().endsWith(".csv");

      if (!isCsv) {
        setParseError("Please drop a CSV file.");
        return;
      }

      void handleFileSelected(file);
    },
    [handleFileSelected],
  );

  const handleSubmit = useCallback(async () => {
    if (!currentTeamId || parsedRows.length === 0 || !targetId) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(
        `/api/teams/${currentTeamId}/${endpointTargetType}/${encodeURIComponent(
          targetId,
        )}/links/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            links: parsedRows,
          }),
        },
      );

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || "Failed to import links");
        setIsSubmitting(false);
        return;
      }

      const data: BulkResponse = await res.json();
      setResponse(data);

      analytics.capture("Links Bulk Imported", {
        teamId: currentTeamId,
        targetType,
        targetId,
        linkType,
        attempted: data.summary.total,
        imported: data.summary.success,
        failed: data.summary.failed,
      });

      if (data.summary.success > 0) {
        mutate(
          `/api/teams/${currentTeamId}/${endpointTargetType}/${encodeURIComponent(
            targetId,
          )}/links`,
        );
        mutate(`/api/teams/${currentTeamId}/limits`);
        onImported?.();
        toast.success(
          data.summary.failed === 0
            ? `Created ${data.summary.success} links`
            : `Created ${data.summary.success} of ${data.summary.total} links`,
        );
      } else {
        toast.error("No links were created. See details below.");
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to import links");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    analytics,
    currentTeamId,
    linkType,
    onImported,
    endpointTargetType,
    parsedRows,
    targetId,
    targetType,
  ]);

  const successCount = response?.summary.success ?? 0;
  const failedCount = response?.summary.failed ?? 0;

  const handleDownloadResults = useCallback(() => {
    if (!response) return;

    const inputHeaders =
      rawHeaders.length > 0
        ? rawHeaders.filter((h) => h && h.length > 0)
        : [...TEMPLATE_HEADERS];

    const resultHeaders = ["status", "linkId", "linkUrl", "error"];
    const headers = [
      "row",
      ...inputHeaders.filter((h) => !resultHeaders.includes(h)),
      ...resultHeaders,
    ];

    const rowsByNumber = new Map<number, Record<string, string>>();
    rawRows.forEach((row, idx) => rowsByNumber.set(idx + 1, row));

    const csvRows = response.results.map((result) => {
      const original = rowsByNumber.get(result.row) ?? {};
      return {
        ...original,
        row: String(result.row),
        status: result.status,
        linkId: result.linkId ?? "",
        linkUrl: result.linkUrl ?? "",
        error: result.error ?? "",
      };
    });

    const csv = stringifyCsv(headers, csvRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const baseName = fileName
      ? fileName.replace(/\.[^.]+$/, "")
      : "papermark-bulk-links";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.setAttribute("download", `${baseName}-results-${stamp}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [fileName, rawHeaders, rawRows, response]);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk create links from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV to create multiple links at once for this{" "}
            {targetType.toLowerCase()}. Each row creates one link and supports
            the same options as the link settings.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <FileSpreadsheetIcon className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                Need a starting point?
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={downloadTemplate}
            >
              <DownloadIcon className="mr-2 h-4 w-4" />
              Download template
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,application/vnd.ms-excel"
            className="hidden"
            onChange={(event) => handleFileSelected(event.target.files?.[0])}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center transition-colors hover:border-foreground/40 hover:bg-muted/40 ${
              isDragging ? "border-foreground/60 bg-muted/60" : "border-input"
            }`}
          >
            <UploadCloudIcon className="h-6 w-6 text-muted-foreground" />
            <div className="text-sm">
              {fileName ? (
                <>
                  <span className="font-medium">{fileName}</span>
                  <span className="ml-1 text-muted-foreground">
                    ({parsedRows.length} row{parsedRows.length === 1 ? "" : "s"}
                    )
                  </span>
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">
                    Click to choose a CSV
                  </span>
                  <span className="ml-1 text-muted-foreground">
                    or drag &amp; drop a file (max 2 MB, {MAX_ROWS} rows)
                  </span>
                </>
              )}
            </div>
          </button>

          {parseError ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{parseError}</span>
            </div>
          ) : null}

          {!response && !canAddLinks ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                You have reached your plan&apos;s link limit
                {limits?.links ? ` of ${limits.links}` : ""}. Upgrade your plan
                to create more links.
              </span>
            </div>
          ) : !response && exceedsLimit && remainingLinks !== null ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Your plan allows {limits?.links} link
                {limits?.links === 1 ? "" : "s"} and you have{" "}
                {remainingLinks === 0
                  ? "no remaining capacity"
                  : `${remainingLinks} remaining`}
                . Only the first {remainingLinks} row
                {remainingLinks === 1 ? "" : "s"} will be created — the rest
                will be skipped. Upgrade your plan to create more links.
              </span>
            </div>
          ) : null}

          {response ? (
            <ResultsList
              results={response.results}
              successCount={successCount}
              failedCount={failedCount}
            />
          ) : parsedRows.length > 0 ? (
            <PreviewList rows={parsedRows} />
          ) : null}
        </div>

        <DialogFooter className="mt-2">
          {response ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleDownloadResults}
                disabled={response.results.length === 0}
              >
                <DownloadIcon className="mr-2 h-4 w-4" />
                Download results CSV
              </Button>
              <Button type="button" onClick={() => handleClose(false)}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleClose(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={
                  isSubmitting ||
                  parsedRows.length === 0 ||
                  !!parseError ||
                  !targetId ||
                  !canAddLinks
                }
              >
                {isSubmitting ? (
                  <>
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                    Creating links…
                  </>
                ) : (
                  `Create ${parsedRows.length || ""} link${
                    parsedRows.length === 1 ? "" : "s"
                  }`.trim()
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewList({ rows }: { rows: LinkPayload[] }) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
        <span>Preview</span>
        <span>
          {rows.length} row{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="max-h-44 overflow-y-auto">
        <ul className="divide-y text-sm">
          {rows.map((row, idx) => (
            <li key={idx} className="flex items-center gap-3 px-3 py-2">
              <span className="w-8 shrink-0 text-xs text-muted-foreground">
                #{idx + 1}
              </span>
              <span className="flex-1 truncate font-medium">
                {row.name || "(unnamed link)"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ResultsList({
  results,
  successCount,
  failedCount,
}: {
  results: BulkResult[];
  successCount: number;
  failedCount: number;
}) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-sm">
        <span className="font-medium">Results</span>
        <span className="text-xs text-muted-foreground">
          <span className="text-emerald-600">{successCount} created</span>
          {failedCount > 0 ? (
            <>
              <span className="mx-1">·</span>
              <span className="text-destructive">{failedCount} failed</span>
            </>
          ) : null}
        </span>
      </div>
      <div className="max-h-72 overflow-y-auto">
        <ul className="divide-y text-sm">
          {results.map((result) => (
            <li
              key={`${result.row}-${result.linkId ?? result.error ?? ""}`}
              className="flex items-start gap-3 px-3 py-2"
            >
              <span className="w-6 shrink-0 pt-0.5 text-xs text-muted-foreground">
                #{result.row}
              </span>
              {result.status === "success" ? (
                <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {result.name || `Link #${result.row}`}
                </div>
                {result.status === "success" && result.linkUrl ? (
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(result.linkUrl!, "Link copied")
                    }
                    className="group inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
                  >
                    <span className="truncate">{result.linkUrl}</span>
                    <CopyIcon className="h-3 w-3 opacity-60 group-hover:opacity-100" />
                  </button>
                ) : (
                  <div className="text-xs text-destructive">{result.error}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
