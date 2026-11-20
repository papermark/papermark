import { useRouter } from "next/router";

import { useCallback, useMemo, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import {
  AlertCircleIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  FolderIcon,
  Loader2Icon,
  UploadCloudIcon,
} from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import { useAnalytics } from "@/lib/analytics";
import { bulkCreateFolders } from "@/lib/folders/create-folder";
import {
  type ParsedFolderRow,
  type SkippedFolderRow,
  parseFoldersFromFile,
  toBulkFolderItems,
} from "@/lib/folders/parse-folder-import";
import { downloadFileFromApi } from "@/lib/utils/download-from-api";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function isSpreadsheet(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    name.endsWith(".csv") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.ms-excel" ||
    file.type === "text/csv"
  );
}

/** Group skipped rows by reason, e.g. `Duplicate hierarchy code "3" (row 15)`. */
function summarizeSkippedRows(skipped: SkippedFolderRow[]): string[] {
  const rowsByReason = new Map<string, number[]>();
  for (const { reason, row } of skipped) {
    const bucket = rowsByReason.get(reason) ?? [];
    bucket.push(row);
    rowsByReason.set(reason, bucket);
  }
  return Array.from(
    rowsByReason,
    ([reason, rows]) =>
      `${reason} (row${rows.length === 1 ? "" : "s"} ${rows.join(", ")})`,
  );
}

export function ImportFoldersModal({
  open,
  setOpen,
  dataroomId,
  onImported,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  dataroomId: string;
  onImported?: () => void;
}) {
  const router = useRouter();
  const teamInfo = useTeam();
  const analytics = useAnalytics();
  const teamId = teamInfo?.currentTeam?.id;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedFolderRow[]>([]);
  const [skipped, setSkipped] = useState<SkippedFolderRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const skippedReasons = useMemo(
    () => summarizeSkippedRows(skipped),
    [skipped],
  );

  // Import under the folder the user is currently viewing, mirroring how the
  // "Create folder" modal reads the current dataroom path from the route.
  const currentFolderPath = router.query.name as string[] | undefined;
  const rootPath =
    currentFolderPath && currentFolderPath.length > 0
      ? "/" + currentFolderPath.join("/")
      : "/";

  const reset = useCallback(() => {
    setFileName(null);
    setRows([]);
    setSkipped([]);
    setParseError(null);
    setIsParsing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleClose = useCallback(
    (next: boolean) => {
      if (!next && !isSubmitting) reset();
      if (!isSubmitting) setOpen(next);
    },
    [isSubmitting, reset, setOpen],
  );

  const handleFile = useCallback(async (file: File | undefined | null) => {
    if (!file) return;
    setParseError(null);
    setRows([]);
    setSkipped([]);

    if (!isSpreadsheet(file)) {
      setParseError("Please choose an .xlsx, .xls, or .csv file.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setParseError(
        "File is larger than 5 MB. Please split it into smaller files.",
      );
      return;
    }

    setIsParsing(true);
    try {
      const result = await parseFoldersFromFile(file);
      if (result.rows.length === 0) {
        setParseError(
          "No folders found. Each row needs at least a folder name.",
        );
        setFileName(file.name);
        setSkipped(result.skipped);
        return;
      }
      setRows(result.rows);
      setSkipped(result.skipped);
      setFileName(file.name);
    } catch (error) {
      setParseError(
        error instanceof Error
          ? error.message
          : "Failed to read the file. Please check the format.",
      );
    } finally {
      setIsParsing(false);
    }
  }, []);

  const handleDownloadTemplate = useCallback(async () => {
    if (!teamId) return;
    setIsDownloadingTemplate(true);
    try {
      await downloadFileFromApi(
        `/api/teams/${teamId}/datarooms/${dataroomId}/folders/import-template`,
        "folders_import_template.xlsx",
      );
    } catch (error) {
      toast.error((error as Error).message || "Failed to download template");
    } finally {
      setIsDownloadingTemplate(false);
    }
  }, [dataroomId, teamId]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
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
      void handleFile(event.dataTransfer?.files?.[0]);
    },
    [handleFile],
  );

  const revalidateDataroomFolders = useCallback(() => {
    if (!teamId) return;
    // Broad one-shot revalidation of every cached folder/document key for this
    // dataroom, matching the bulk folder-upload flow in upload-zone.tsx.
    mutate(
      (key: unknown) =>
        typeof key === "string" &&
        (key.startsWith(
          `/api/teams/${teamId}/datarooms/${dataroomId}/folders`,
        ) ||
          key.startsWith(
            `/api/teams/${teamId}/datarooms/${dataroomId}/folder-documents`,
          ) ||
          key.startsWith(
            `/api/teams/${teamId}/datarooms/${dataroomId}/documents`,
          )),
    );
  }, [dataroomId, teamId]);

  const handleSubmit = useCallback(async () => {
    if (rows.length === 0 || !teamId) return;
    setIsSubmitting(true);
    try {
      // Parsing caps the sheet at MAX_IMPORT_FOLDERS, which is the server's
      // per-request limit, so the whole import is always one transaction.
      const created = await bulkCreateFolders({
        url: `/api/teams/${teamId}/datarooms/${dataroomId}/folders/bulk`,
        rootPath,
        folders: toBulkFolderItems(rows),
      });

      analytics.capture("Folder Added (bulk import)", {
        count: created.length,
        dataroomId,
      });

      revalidateDataroomFolders();
      toast.success(
        created.length === 1
          ? "Imported 1 folder"
          : `Imported ${created.length} folders`,
      );
      reset();
      setOpen(false);
      onImported?.();
    } catch (error) {
      toast.error((error as Error).message || "Failed to import folders");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    analytics,
    dataroomId,
    onImported,
    reset,
    revalidateDataroomFolders,
    rootPath,
    rows,
    setOpen,
    teamId,
  ]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import folders from Excel</DialogTitle>
          <DialogDescription>
            Upload an Excel (.xlsx) or CSV file to create many folders at once.
            Use one column for the hierarchy (e.g. 1, 1.1, 1.2) and one for the
            folder name.
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
              onClick={() => void handleDownloadTemplate()}
              loading={isDownloadingTemplate}
            >
              <DownloadIcon className="mr-2 h-4 w-4" />
              Download template
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = "";
            }}
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
            {isParsing ? (
              <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <UploadCloudIcon className="h-6 w-6 text-muted-foreground" />
            )}
            <div className="text-sm">
              {fileName ? (
                <>
                  <span className="font-medium">{fileName}</span>
                  {rows.length > 0 ? (
                    <span className="ml-1 text-muted-foreground">
                      ({rows.length} folder{rows.length === 1 ? "" : "s"})
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">
                    Click to choose a file
                  </span>
                  <span className="ml-1 text-muted-foreground">
                    or drag &amp; drop (.xlsx, .xls, .csv — max 5 MB)
                  </span>
                </>
              )}
            </div>
          </button>

          {rootPath !== "/" ? (
            <p className="text-xs text-muted-foreground">
              Folders will be created inside{" "}
              <span className="font-medium text-foreground">{rootPath}</span>.
            </p>
          ) : null}

          {parseError ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{parseError}</span>
            </div>
          ) : null}

          {skipped.length > 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p>
                  Skipping {skipped.length} row
                  {skipped.length === 1 ? "" : "s"}:
                </p>
                <ul className="ml-4 list-disc">
                  {skippedReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {rows.length > 0 ? <PreviewTree rows={rows} /> : null}
        </div>

        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || rows.length === 0 || isParsing}
          >
            {isSubmitting ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                Importing…
              </>
            ) : rows.length === 0 ? (
              "Import folders"
            ) : (
              `Import ${rows.length} folder${rows.length === 1 ? "" : "s"}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewTree({ rows }: { rows: ParsedFolderRow[] }) {
  const preview = useMemo(() => rows.slice(0, 100), [rows]);
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
        <span>Preview</span>
        <span>
          {rows.length} folder{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="max-h-60 overflow-y-auto">
        <ul className="divide-y text-sm">
          {preview.map((row) => (
            <li key={row.tempId} className="flex items-center gap-2 px-3 py-2">
              <span
                className="flex min-w-0 items-center gap-2"
                style={{ paddingLeft: `${Math.min(row.depth, 8) * 16}px` }}
              >
                <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{row.name}</span>
              </span>
              {row.hierarchy ? (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {row.hierarchy}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {rows.length > preview.length ? (
          <div className="border-t px-3 py-2 text-center text-xs text-muted-foreground">
            + {rows.length - preview.length} more
          </div>
        ) : null}
      </div>
    </div>
  );
}
