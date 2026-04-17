import { memo, useCallback, useMemo, useState } from "react";

import {
  AlertTriangleIcon,
  BanIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

import { usePlan } from "@/lib/swr/use-billing";

import { Gauge } from "./ui/gauge";
import { ButtonTooltip } from "./ui/tooltip";
import { RejectedFile, UploadBatchState, UploadItemState } from "./upload-zone";

interface UploadNotificationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: UploadBatchState | null;
  setBatch: (batch: UploadBatchState | null) => void;
  rejectedFiles: RejectedFile[];
  setRejectedFiles: (rejected: RejectedFile[]) => void;
  handleCloseDrawer: () => void;
  onCancel?: () => void;
  onCancelItem?: (itemId: string) => void;
}

function formatTimeLeft(ms: number): string {
  if (ms < 1000) return "Finishing upload...";
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} sec left...`;
  const minutes = Math.ceil(totalSeconds / 60);
  return `${minutes} min left...`;
}

const ItemRow = memo(
  function ItemRow({
    item,
    onCancelItem,
    isBatchDone,
  }: {
    item: UploadItemState;
    onCancelItem?: (itemId: string) => void;
    isBatchDone: boolean;
  }) {
  const [hovered, setHovered] = useState(false);
  const done =
    item.completedEntries + item.failedEntries >= item.totalEntries;
  const progress = done
    ? 100
    : item.bytesTotal && item.bytesTotal > 0
      ? Math.min(
          Math.round(((item.bytesUploaded ?? 0) / item.bytesTotal) * 100),
          99,
        )
      : item.totalEntries > 0
        ? Math.round(
            ((item.completedEntries + item.failedEntries) /
              item.totalEntries) *
              100,
          )
        : 0;

  const indicator = () => {
    if (item.cancelled) {
      return (
        <ButtonTooltip content="Upload cancelled" sideOffset={4}>
          <BanIcon className="h-5 w-5 text-muted-foreground" />
        </ButtonTooltip>
      );
    }

    if (done) {
      if (hovered) {
        const icon =
          item.type === "folder" ? (
            <FolderIcon className="h-4 w-4 text-foreground" />
          ) : (
            <FileIcon className="h-4 w-4 text-foreground" />
          );

        return item.folderHref ? (
          <a
            href={item.folderHref}
            className="flex h-5 w-5 items-center justify-center"
            title={`Open ${item.name}`}
          >
            {icon}
          </a>
        ) : (
          <span className="flex h-5 w-5 items-center justify-center">
            {icon}
          </span>
        );
      }
      return (
        <CheckIcon
          className="h-5 w-5 rounded-full bg-emerald-500 p-0.5 text-white"
          strokeWidth={3}
        />
      );
    }

    if (hovered && onCancelItem && !isBatchDone) {
      return (
        <button
          onClick={() => onCancelItem(item.itemId)}
          className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"
          title="Cancel upload"
        >
          <XIcon className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      );
    }

    return (
      <div className="flex h-5 w-5 items-center justify-center">
        <Gauge value={progress} size="xxs" showValue={false} />
      </div>
    );
  };

  return (
    <div
      className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-2.5 overflow-hidden">
        {item.type === "folder" ? (
          <FolderIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
        ) : (
          <FileIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        {done && item.folderHref ? (
          <a
            href={item.folderHref}
            className="truncate text-sm hover:underline"
            title={`Open ${item.name}`}
          >
            {item.name}
          </a>
        ) : (
          <span className="truncate text-sm">{item.name}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {!item.cancelled &&
          (item.totalEntries > 0 ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {item.completedEntries} of {item.totalEntries}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Preparing...
            </span>
          ))}
        <div className="flex h-5 w-5 items-center justify-center">
          {item.totalEntries === 0 && !item.cancelled ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-primary" />
          ) : (
            indicator()
          )}
        </div>
      </div>
    </div>
  );
  },
  (prev, next) => {
    const a = prev.item;
    const b = next.item;
    return (
      a.itemId === b.itemId &&
      a.completedEntries === b.completedEntries &&
      a.failedEntries === b.failedEntries &&
      a.totalEntries === b.totalEntries &&
      a.cancelled === b.cancelled &&
      a.bytesUploaded === b.bytesUploaded &&
      a.folderHref === b.folderHref &&
      prev.isBatchDone === next.isBatchDone &&
      prev.onCancelItem === next.onCancelItem
    );
  },
);

function CollapsibleSection({
  icon,
  label,
  count,
  colorClass,
  bgClass,
  cta,
  items,
  onDownload,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  colorClass: string;
  bgClass: string;
  cta?: { label: string; href: string };
  items: RejectedFile[];
  onDownload?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`border-t border-gray-200 dark:border-gray-700`}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center justify-between px-4 py-2 ${bgClass}`}
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDownIcon className={`h-3.5 w-3.5 ${colorClass}`} />
          ) : (
            <ChevronRightIcon className={`h-3.5 w-3.5 ${colorClass}`} />
          )}
          {icon}
          <span className={`text-xs font-medium ${colorClass}`}>
            {count} {label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onDownload ? (
            <ButtonTooltip content="Download list" sideOffset={4}>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload();
                }}
                className={`rounded p-1 ${colorClass} hover:bg-black/5 dark:hover:bg-white/10`}
              >
                <DownloadIcon className="h-3.5 w-3.5" />
              </span>
            </ButtonTooltip>
          ) : null}
          {cta ? (
            <a
              href={cta.href}
              onClick={(e) => e.stopPropagation()}
              className={`rounded px-2.5 py-1 text-xs font-medium ${colorClass} hover:underline`}
            >
              {cta.label}
            </a>
          ) : null}
        </div>
      </button>
      {open
        ? items.map((rejected, index) => (
            <div
              key={index}
              className={`flex items-center justify-between px-4 py-2 text-sm ${colorClass} hover:bg-gray-50 dark:hover:bg-gray-800/50`}
            >
              <span className="w-56 truncate">{rejected.fileName}</span>
              <span className="shrink-0 text-xs">{rejected.message}</span>
            </div>
          ))
        : null}
    </div>
  );
}

export function UploadNotificationDrawer({
  open,
  onOpenChange,
  batch,
  setBatch,
  rejectedFiles,
  setRejectedFiles,
  handleCloseDrawer,
  onCancel,
  onCancelItem,
}: UploadNotificationDrawerProps) {
  const [expanded, setExpanded] = useState(true);
  const { isDatarooms } = usePlan();

  const totalEntries = batch?.totalEntries ?? 0;
  const completedEntries = batch?.completedEntries ?? 0;
  const batchFailedEntries = batch?.failedEntries ?? 0;
  const isCancelled = batch?.cancelled === true;
  const isComplete =
    !isCancelled &&
    completedEntries + batchFailedEntries >= totalEntries &&
    totalEntries > 0;
  const isDone = isComplete || isCancelled;

  const itemCount = batch?.items.length ?? 0;
  const isPreparing = batch === null || itemCount === 0;

  // js-combine-iterations: single pass to partition rejected files
  const { skippedFiles, failedFiles } = useMemo(() => {
    const skipped: RejectedFile[] = [];
    const failed: RejectedFile[] = [];
    for (const rf of rejectedFiles) {
      if (rf.reason === "plan-limit" || rf.reason === "max-files") {
        skipped.push(rf);
      } else {
        failed.push(rf);
      }
    }
    return { skippedFiles: skipped, failedFiles: failed };
  }, [rejectedFiles]);

  const skippedCta = useMemo(() => {
    if (skippedFiles.length === 0) return undefined;
    const hasPlanLimit = skippedFiles.some((f) => f.reason === "plan-limit");
    const hasMaxFiles = skippedFiles.some((f) => f.reason === "max-files");

    if (hasPlanLimit) {
      return { label: "Upgrade", href: "/settings/billing" };
    }
    if (hasMaxFiles && isDatarooms) {
      return {
        label: "Contact support",
        href: "mailto:support@papermark.com",
      };
    }
    return { label: "Upgrade", href: "/settings/billing" };
  }, [skippedFiles, isDatarooms]);

  const skippedLabel = useMemo(() => {
    const hasPlanLimit = skippedFiles.some((f) => f.reason === "plan-limit");
    return hasPlanLimit
      ? "not uploaded (plan limit)"
      : "not uploaded (upload limit)";
  }, [skippedFiles]);

  const handleDownloadSkipped = useCallback(() => {
    const allNames: string[] = [];
    for (const rf of skippedFiles) {
      if (rf.skippedFileNames?.length) {
        allNames.push(...rf.skippedFileNames);
      } else {
        allNames.push(rf.fileName);
      }
    }
    if (allNames.length === 0) return;

    const content = allNames.join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "skipped-files.txt";
    a.click();
    URL.revokeObjectURL(url);
  }, [skippedFiles]);

  const hasDownloadableSkipped = useMemo(
    () => skippedFiles.some((rf) => rf.skippedFileNames?.length || rf.fileName),
    [skippedFiles],
  );

  const timeLeftLabel = useMemo(() => {
    if (!batch || isDone) return null;
    const elapsed = Date.now() - batch.startedAt;

    // Prefer byte-level progress for accurate time estimation (critical for single large files)
    const batchBytesTotal = batch.bytesTotal ?? 0;
    const batchBytesUploaded = batch.bytesUploaded ?? 0;
    if (batchBytesTotal > 0 && batchBytesUploaded > 0) {
      if (elapsed < 2000) return "Calculating...";
      const rate = batchBytesUploaded / elapsed;
      const remaining = batchBytesTotal - batchBytesUploaded;
      const msLeft = remaining / rate;
      return formatTimeLeft(msLeft);
    }

    // Fallback to entry-based estimation
    const processed = completedEntries + batchFailedEntries;
    if (processed === 0 || elapsed < 2000) return "Calculating...";
    const rate = processed / elapsed;
    const remaining = totalEntries - processed;
    const msLeft = remaining / rate;
    return formatTimeLeft(msLeft);
  }, [batch, completedEntries, batchFailedEntries, totalEntries, isDone]);

  const onOpenChangeHandler = (open: boolean) => {
    onOpenChange(open);
    if (!open) {
      setBatch(null);
      setRejectedFiles([]);
    }
  };

  const cancelledItemCount =
    batch?.items.filter((it) => it.cancelled).length ?? 0;

  const headerTitle = isPreparing
    ? "Preparing upload..."
    : isCancelled
      ? cancelledItemCount === itemCount
        ? `${itemCount} upload${itemCount !== 1 ? "s" : ""} canceled`
        : "Upload canceled"
      : isComplete
        ? `${itemCount} upload${itemCount !== 1 ? "s" : ""} complete`
        : `Uploading ${itemCount} item${itemCount !== 1 ? "s" : ""}`;

  return (
    <div className="h-50 fixed bottom-0 right-20 z-50">
      <Drawer
        modal={false}
        open={open}
        onOpenChange={onOpenChangeHandler}
        dismissible={false}
      >
        <DrawerContent className="inset-x-auto right-6 max-h-[400px] w-1/5 min-w-[350px] max-w-[400px] shadow-md focus-visible:outline-none">
          <DrawerHeader className="flex h-auto items-center justify-between rounded-t-lg border-b border-gray-200 bg-gray-100 px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
            <DrawerTitle className="text-sm font-medium">
              {headerTitle}
            </DrawerTitle>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => setExpanded(!expanded)}
                className="rounded-full p-1 hover:bg-gray-200 dark:hover:bg-gray-800"
              >
                {expanded ? (
                  <ChevronDownIcon className="h-5 w-5" />
                ) : (
                  <ChevronUpIcon className="h-5 w-5" />
                )}
              </button>
              <DrawerClose
                className="rounded-full p-1 hover:bg-gray-200 dark:hover:bg-gray-800"
                onClick={handleCloseDrawer}
              >
                <XIcon className="h-5 w-5" />
              </DrawerClose>
            </div>
          </DrawerHeader>

          {expanded ? (
            <>
              {!isDone && !isPreparing && timeLeftLabel ? (
                <div className="flex items-center justify-between border-b border-gray-200 bg-blue-50/60 px-4 py-2 dark:border-gray-700 dark:bg-blue-950/30">
                  <span className="text-xs text-muted-foreground">
                    {timeLeftLabel}
                  </span>
                  {onCancel ? (
                    <button
                      onClick={onCancel}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="flex w-full flex-1 flex-col overflow-y-auto">
                {batch?.items.map((item) => (
                  <ItemRow
                    key={item.itemId}
                    item={item}
                    onCancelItem={onCancelItem}
                    isBatchDone={isDone}
                  />
                ))}
              </div>

              {skippedFiles.length > 0 ? (
                <CollapsibleSection
                  icon={
                    <AlertTriangleIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  }
                  label={skippedLabel}
                  count={skippedFiles.length}
                  colorClass="text-amber-600 dark:text-amber-400"
                  bgClass="bg-amber-50/60 dark:bg-amber-950/30"
                  cta={skippedCta}
                  items={skippedFiles}
                  onDownload={
                    hasDownloadableSkipped ? handleDownloadSkipped : undefined
                  }
                />
              ) : null}

              {failedFiles.length > 0 ? (
                <CollapsibleSection
                  icon={
                    <XCircleIcon className="h-3.5 w-3.5 text-destructive" />
                  }
                  label="failed"
                  count={failedFiles.length}
                  colorClass="text-destructive"
                  bgClass="bg-red-50/60 dark:bg-red-950/30"
                  items={failedFiles}
                />
              ) : null}
            </>
          ) : null}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
