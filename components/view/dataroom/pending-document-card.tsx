import { useRouter } from "next/router";

import { useEffect } from "react";
import type { CSSProperties } from "react";

import {
  AlertCircle,
  CheckCircle2,
  FileIcon,
  FolderIcon,
  Loader2,
  Upload,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import useSWRImmutable from "swr/immutable";

import {
  PendingUploadDocument,
  usePendingUploads,
} from "@/context/pending-uploads-context";
import { cn, fetcher } from "@/lib/utils";
import { fileIcon } from "@/lib/utils/get-file-icon";
import { useDocumentProgressStatus } from "@/lib/utils/use-progress-status";

import { Progress } from "@/components/ui/progress";
import { useViewerSurfaceTheme } from "@/components/view/viewer/viewer-surface-theme";

type FolderInfo = {
  id: string;
  name: string;
  parentId: string | null;
};

type PendingDocumentCardProps = {
  pendingUpload: PendingUploadDocument;
  /** Flat list of all folders for resolving folder paths */
  folders?: FolderInfo[];
  /** Link ID for building document URLs */
  linkId?: string;
  /** Callback to navigate to a folder */
  onNavigateToFolder?: (folderId: string | null) => void;
  /** Whether to show the folder path (used in My Uploads tab) */
  showFolderPath?: boolean;
};

/** Build a breadcrumb path like "Home > Company Info > Financials > Q4".
 *  `homeLabel` is injected so the label can be localized at the call site —
 *  folder names are admin-authored and intentionally left as-is. */
function getFolderPath(
  folderId: string | null,
  folders: FolderInfo[],
  homeLabel: string,
): string {
  if (!folderId) return homeLabel;

  const parts: string[] = [homeLabel];
  const folderParts: string[] = [];
  let current = folders.find((f) => f.id === folderId);
  while (current) {
    folderParts.unshift(current.name);
    current = current.parentId
      ? folders.find((f) => f.id === current!.parentId)
      : undefined;
  }
  return [...parts, ...folderParts].join(" > ");
}

export default function PendingDocumentCard({
  pendingUpload,
  folders = [],
  linkId,
  onNavigateToFolder,
  showFolderPath = false,
}: PendingDocumentCardProps) {
  const { t } = useTranslation("dataroom");
  const { theme, systemTheme } = useTheme();
  const router = useRouter();
  const { updatePendingUpload } = usePendingUploads();
  const { palette } = useViewerSurfaceTheme();
  const isLight =
    theme === "light" || (theme === "system" && systemTheme === "light");

  const { previewToken, domain, slug } = router.query as {
    previewToken?: string;
    domain?: string;
    slug?: string;
  };

  // Fetch trigger public access token for processing documents
  const needsTriggerTracking =
    pendingUpload.status === "processing" && pendingUpload.documentVersionId;

  const { data: tokenData } = useSWRImmutable<{ publicAccessToken: string }>(
    needsTriggerTracking
      ? `/api/progress-token?documentVersionId=${pendingUpload.documentVersionId}`
      : null,
    fetcher,
  );

  // Subscribe to Trigger.dev realtime for processing status
  const { status: triggerStatus } = useDocumentProgressStatus(
    pendingUpload.documentVersionId ?? "",
    tokenData?.publicAccessToken,
  );

  // When trigger reports COMPLETED, update the upload status
  useEffect(() => {
    if (
      needsTriggerTracking &&
      triggerStatus.state === "COMPLETED" &&
      pendingUpload.status === "processing"
    ) {
      updatePendingUpload(pendingUpload.id, { status: "complete" });
    }
  }, [
    triggerStatus.state,
    needsTriggerTracking,
    pendingUpload.status,
    pendingUpload.id,
    updatePendingUpload,
  ]);

  const isError = pendingUpload.status === "error";
  const isUploading = pendingUpload.status === "uploading";
  const isProcessing = pendingUpload.status === "processing";
  const isComplete = pendingUpload.status === "complete";
  const isClickable = isComplete && pendingUpload.dataroomDocumentId && linkId;

  const getStatusText = () => {
    switch (pendingUpload.status) {
      case "uploading":
        return `Uploading... ${pendingUpload.progress}%`;
      case "processing":
        // Use trigger realtime text if available
        if (triggerStatus.state === "EXECUTING" && triggerStatus.text) {
          return triggerStatus.text;
        }
        if (triggerStatus.state === "QUEUED") {
          return "Queued for processing...";
        }
        return "Processing document...";
      case "error":
        return pendingUpload.errorMessage || "Upload failed";
      case "complete":
        return "Ready";
      default:
        return "Pending";
    }
  };

  const getStatusIcon = () => {
    switch (pendingUpload.status) {
      case "uploading":
        return <Upload className="h-4 w-4 animate-pulse text-blue-500" />;
      case "processing":
        return <Loader2 className="h-4 w-4 animate-spin text-orange-500" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case "complete":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      default:
        return null;
    }
  };

  // Real processing progress from trigger (0-100)
  const processingProgress =
    isProcessing && triggerStatus.state === "EXECUTING"
      ? triggerStatus.progress
      : undefined;

  const handleDocumentClick = (e: React.MouseEvent) => {
    if (!isClickable) {
      if (isProcessing) {
        e.preventDefault();
        toast.error(
          "Document is still processing. Please wait a moment and try again.",
        );
      }
      return;
    }

    e.preventDefault();
    if (domain && slug) {
      window.open(
        `/${slug}/d/${pendingUpload.dataroomDocumentId}`,
        "_blank",
      );
    } else if (linkId) {
      window.open(
        `/view/${linkId}/d/${pendingUpload.dataroomDocumentId}${
          previewToken ? `?previewToken=${previewToken}&preview=1` : ""
        }`,
        "_blank",
      );
    }
  };

  const handleFolderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onNavigateToFolder) {
      onNavigateToFolder(pendingUpload.folderId);
    }
  };

  const folderPath =
    showFolderPath && folders.length > 0
      ? getFolderPath(pendingUpload.folderId, folders, t("breadcrumb.home", "Home"))
      : null;

  return (
    <div
      className={cn(
        "group/row relative flex items-center justify-between rounded-lg border p-3 transition-all sm:p-4",
        "bg-[var(--viewer-panel-bg)] hover:bg-[var(--viewer-panel-bg-hover)]",
        "border-[var(--viewer-panel-border)] hover:border-[var(--viewer-panel-border-hover)]",
        isError && "border-red-400/40",
        (isUploading || isProcessing) && "opacity-80",
      )}
      style={
        {
          "--viewer-panel-bg": palette.panelBgColor,
          "--viewer-panel-bg-hover": palette.panelHoverBgColor,
          "--viewer-panel-border": palette.panelBorderColor,
          "--viewer-panel-border-hover": palette.panelBorderHoverColor,
          "--viewer-text": palette.textColor,
          "--viewer-muted-text": palette.mutedTextColor,
          "--viewer-subtle-text": palette.subtleTextColor,
          "--viewer-control-bg": palette.controlBgColor,
          "--viewer-control-border": palette.controlBorderColor,
        } as CSSProperties
      }
    >
      {/* Clickable overlay for opening documents */}
      {isClickable && (
        <button
          onClick={handleDocumentClick}
          className="absolute inset-0 z-0 cursor-pointer"
          aria-hidden="true"
        />
      )}

      {/* pointer-events-none so clicks fall through to the button overlay above */}
      <div
        className={cn(
          "flex min-w-0 shrink items-center space-x-2 sm:space-x-4",
          isClickable && "pointer-events-none",
        )}
      >
        <div className="mx-0.5 flex w-8 items-center justify-center text-center sm:mx-1">
          {pendingUpload.fileType ? (
            fileIcon({
              fileType: pendingUpload.fileType,
              className: "h-8 w-8 opacity-60",
              isLight,
            })
          ) : (
            <FileIcon className="h-8 w-8 opacity-60" style={{ color: palette.mutedTextColor }} />
          )}
        </div>

        <div className="min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 max-w-[300px] truncate text-sm font-semibold leading-6 text-[var(--viewer-text)] sm:max-w-lg">
              {pendingUpload.name}
            </h2>
            {getStatusIcon()}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <p
              className={cn(
                "text-xs leading-5",
                isError
                  ? "text-red-500"
                  : isComplete
                    ? "text-green-500"
                    : "text-[var(--viewer-muted-text)]",
              )}
            >
              {getStatusText()}
            </p>
            {folderPath && isComplete && (
              <>
                <span className="text-xs text-[var(--viewer-subtle-text)]">
                  ·
                </span>
                <button
                  onClick={handleFolderClick}
                  className="pointer-events-auto z-10 flex items-center gap-1 text-xs text-[var(--viewer-muted-text)] transition-colors hover:text-[var(--viewer-text)]"
                >
                  <FolderIcon className="h-3 w-3" />
                  <span className="max-w-[200px] truncate sm:max-w-[300px]">
                    {folderPath}
                  </span>
                </button>
              </>
            )}
            {folderPath && !isComplete && (
              <>
                <span className="text-xs text-[var(--viewer-subtle-text)]">
                  ·
                </span>
                <span className="flex items-center gap-1 text-xs text-[var(--viewer-muted-text)]">
                  <FolderIcon className="h-3 w-3" />
                  <span className="max-w-[200px] truncate sm:max-w-[300px]">
                    {folderPath}
                  </span>
                </span>
              </>
            )}
          </div>
          {(isUploading || isProcessing) && (
            <Progress
              value={
                isProcessing
                  ? (processingProgress ?? 0)
                  : pendingUpload.progress
              }
              className={cn(
                "mt-1.5 h-1 w-full max-w-[200px]",
                isProcessing && !processingProgress && "animate-pulse",
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}
