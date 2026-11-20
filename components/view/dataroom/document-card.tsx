import { useRouter } from "next/router";

import React from "react";

import { Download, MoreVerticalIcon } from "lucide-react";

import { type DataroomCardLayout } from "@/ee/features/branding/lib/dataroom-viewer-layout";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { timeAgoLocalized } from "@/lib/i18n/format";
import { asSupportedLocale, DEFAULT_LOCALE } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";
import { downloadFromLinkEndpoint } from "@/lib/utils/download-document";
import { ensureFileExtension } from "@/lib/utils/get-content-type";
import { fileIcon } from "@/lib/utils/get-file-icon";
import { HIERARCHICAL_DISPLAY_STYLE } from "@/lib/utils/hierarchical-display";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { compactDataroomListGridClass } from "@/components/view/dataroom/compact-dataroom-list-header";
import { useViewerSurfaceTheme } from "@/components/view/viewer/viewer-surface-theme";

import { DocumentVersion } from "../viewer/dataroom-viewer";

function formatEditorialFileSize(bytes?: number | bigint | null): string {
  if (bytes == null) return "—";
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 && u > 0 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

type DRDocument = {
  dataroomDocumentId: string;
  id: string;
  name: string;
  downloadOnly: boolean;
  versions: DocumentVersion[];
  canDownload: boolean;
  hierarchicalIndex: string | null;
};

type DocumentsCardProps = {
  document: DRDocument;
  linkId: string;
  viewId?: string;
  isPreview: boolean;
  allowDownload: boolean;
  isProcessing?: boolean;
  dataroomIndexEnabled?: boolean;
  showLastUpdated?: boolean;
  layout?: DataroomCardLayout;
  /** Compact table: include Updated column */
  compactShowUpdatedColumn?: boolean;
  /** Compact table: reserve Settings column (including spacer when row has no menu) */
  compactShowActionsColumn?: boolean;
  /** Strict / compact table: dedicated left column for index */
  compactShowIndexColumn?: boolean;
  editorialList?: boolean;
  editorialIndex?: number;
  documentFolderLabel?: string | null;
};

export default function DocumentCard({
  document,
  linkId,
  viewId,
  isPreview,
  allowDownload,
  isProcessing = false,
  dataroomIndexEnabled,
  showLastUpdated = true,
  layout = "LIST",
  compactShowUpdatedColumn = true,
  compactShowActionsColumn = true,
  compactShowIndexColumn = false,
  editorialList = false,
  editorialIndex = 0,
  documentFolderLabel = null,
}: DocumentsCardProps) {
  const { theme, systemTheme } = useTheme();
  const { palette } = useViewerSurfaceTheme();
  const { t, i18n } = useTranslation("dataroom");
  const activeLocale = asSupportedLocale(i18n.language) ?? DEFAULT_LOCALE;
  const canDownload = document.canDownload && allowDownload;

  const isLight =
    theme === "light" || (theme === "system" && systemTheme === "light");
  const router = useRouter();

  const plainTitle =
    layout === "COMPACT" || (layout === "LIST" && editorialList);
  const hierIndex = document.hierarchicalIndex?.trim() || "";
  const fallbackIndexLabel = String(editorialIndex + 1).padStart(2, "0");
  // Only the COMPACT layout (UI "List") keeps auto-numbered fallbacks like
  // 01/02/03 so the table always feels indexed. GRID (Notion) and LIST (UI
  // "Cards") show numbers only when an admin has set an explicit
  // hierarchical index.
  const inlineIndexPrefix = hierIndex
    ? hierIndex
    : layout === "COMPACT"
      ? fallbackIndexLabel
      : "";
  // String form kept for accessibility/title attributes.
  const displayName =
    plainTitle || !inlineIndexPrefix
      ? document.name
      : `${inlineIndexPrefix} ${document.name}`;
  const displayNameNode =
    plainTitle || !inlineIndexPrefix ? (
      document.name
    ) : (
      <>
        <span>{inlineIndexPrefix}</span> {document.name}
      </>
    );
  const { previewToken, domain, slug } = router.query as {
    previewToken?: string;
    domain?: string;
    slug?: string;
  };

  const handleDocumentClick = (e: React.MouseEvent) => {
    if (isProcessing) {
      e.preventDefault();
      toast.error(t("navToasts.documentStillProcessing", "Document is still processing. Please wait a moment and try again."));
      return;
    }

    e.preventDefault();

    const targetUrl =
      domain && slug
        ? `/${slug}/d/${document.dataroomDocumentId}`
        : `/view/${linkId}/d/${document.dataroomDocumentId}${
            previewToken ? `?previewToken=${previewToken}&preview=1` : ""
          }`;

    // On mobile, navigate in the same tab. Opening a new tab there forces the
    // visitor to re-run the access form and juggle tabs to get back. Same-tab
    // navigation reuses the existing dataroom session; the nav "Home"
    // breadcrumb returns them to the dataroom. Desktop keeps new-tab so
    // multiple documents can be compared side by side. Read the breakpoint on
    // demand instead of subscribing every card to window resizes (a dataroom
    // with N documents would otherwise install N resize listeners).
    const isMobile = window.matchMedia("(max-width: 640px)").matches;
    if (isMobile) {
      router.push(targetUrl);
    } else {
      window.open(targetUrl, "_blank");
    }
  };

  const downloadDocument = async () => {
    if (isPreview) {
      toast.error(t("navToasts.cannotDownloadDocPreview", "You cannot download dataroom document in preview mode."));
      return;
    }

    const downloadPromise = downloadFromLinkEndpoint({
      endpoint: "/api/links/download/dataroom-document",
      body: { linkId, viewId, documentId: document.id },
      fallbackFileName: ensureFileExtension({
        name: document.name,
        type: document.versions[0]?.type,
      }),
    });

    toast.promise(downloadPromise, {
      loading: t("navToasts.downloadPreparing", "Preparing download..."),
      success: t("navToasts.downloadSuccess", "File downloaded successfully"),
      error: (err) => err.message || t("navToasts.downloadFailed", "Failed to download file"),
    });
  };

  const sharedStyle = {
    "--viewer-panel-bg": palette.panelBgColor,
    "--viewer-panel-bg-hover": palette.panelHoverBgColor,
    "--viewer-panel-border": palette.panelBorderColor,
    "--viewer-panel-border-hover": palette.panelBorderHoverColor,
    "--viewer-text": palette.textColor,
    "--viewer-muted-text": palette.mutedTextColor,
    "--viewer-control-bg": palette.controlBgColor,
    "--viewer-control-border": palette.controlBorderColor,
    "--viewer-control-border-strong": palette.controlBorderStrongColor,
    "--viewer-control-icon": palette.controlIconColor,
  } as React.CSSProperties;

  const downloadMenuButton = canDownload && !isProcessing && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8 border bg-transparent p-0",
            "text-[var(--viewer-control-icon)] border-[var(--viewer-control-border)] hover:bg-[var(--viewer-control-bg)]",
            "group-hover/row:text-[var(--viewer-text)] group-hover/row:border-[var(--viewer-control-border-strong)]",
          )}
          aria-label={t("cards.openMenu", "Open menu")}
        >
          <MoreVerticalIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("cards.actionsLabel", "Actions")}</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            downloadDocument();
          }}
        >
          <Download className="h-4 w-4" />
          {t("cards.download", "Download")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (layout === "GRID") {
    // See FolderCard GRID for the click-through pattern: full-surface button
    // sits behind the content (z-0, pointer-events from default), content
    // layers use pointer-events-none so clicks pass through to the button,
    // and the download menu re-enables pointer events only on itself.
    return (
      <div
        className={cn(
          "group/row relative flex h-full cursor-pointer flex-col overflow-hidden rounded-lg border transition-all",
          "bg-[var(--viewer-panel-bg)] hover:bg-[var(--viewer-panel-bg-hover)]",
          "border-[var(--viewer-panel-border)] hover:border-[var(--viewer-panel-border-hover)]",
          isProcessing && "cursor-not-allowed opacity-60",
        )}
        style={sharedStyle}
      >
        <button
          onClick={handleDocumentClick}
          className="absolute inset-0 z-0 cursor-pointer"
          disabled={isProcessing}
          aria-label={t("cards.openDocument", "Open document {{name}}", { name: document.name })}
        />

        {/* Preview area */}
        <div
          className={cn(
            "pointer-events-none relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden border-b",
            "border-[var(--viewer-panel-border)]",
          )}
          style={{
            backgroundColor: palette.controlBgColor,
          }}
        >
          {fileIcon({
            fileType: document.versions[0].type ?? "",
            className: "h-16 w-16 sm:h-20 sm:w-20",
            isLight,
          })}
        </div>

        {/* Info area */}
        <div className="pointer-events-none relative flex items-center justify-between gap-2 p-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center">
              {fileIcon({
                fileType: document.versions[0].type ?? "",
                className: "h-5 w-5",
                isLight,
              })}
            </div>
            <div className="min-w-0 flex-1">
              <h2
                className="truncate text-sm font-medium leading-5 text-[var(--viewer-text)]"
                style={HIERARCHICAL_DISPLAY_STYLE}
              >
                {displayNameNode}
                {isProcessing && (
                  <span className="ml-2 text-xs text-[var(--viewer-muted-text)]">
                    {t("cards.processing", "(Processing...)")}
                  </span>
                )}
              </h2>
              {showLastUpdated && (
                <p className="truncate text-xs leading-4 text-[var(--viewer-muted-text)]">
                  {t("cards.updated", "Updated {{when}}", {
                    when: timeAgoLocalized(
                      document.versions[0].updatedAt,
                      activeLocale,
                    ),
                  })}
                </p>
              )}
            </div>
          </div>
          {downloadMenuButton && (
            <div className="pointer-events-auto relative z-10">
              {downloadMenuButton}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (layout === "COMPACT") {
    const indexLabel =
      document.hierarchicalIndex?.trim() ||
      String(editorialIndex + 1).padStart(2, "0");
    const gridClass = compactDataroomListGridClass(
      compactShowUpdatedColumn && showLastUpdated,
      compactShowActionsColumn,
      compactShowIndexColumn,
    );
    const showUpdatedCell =
      compactShowUpdatedColumn && showLastUpdated;
    const actionsSlot = compactShowActionsColumn ? (
      downloadMenuButton ? (
        <div className="z-10 flex justify-end pointer-events-auto">
          {downloadMenuButton}
        </div>
      ) : (
        <span className="inline-flex h-8 w-8 shrink-0" aria-hidden />
      )
    ) : null;

    const nameBlock = (
      <>
        <div className="flex h-6 w-6 shrink-0 items-center justify-center">
          {fileIcon({
            fileType: document.versions[0].type ?? "",
            className: "h-5 w-5",
            isLight,
          })}
        </div>
        <h2
          className="truncate text-sm font-medium leading-5 text-[var(--viewer-text)]"
          style={HIERARCHICAL_DISPLAY_STYLE}
        >
          {displayNameNode}
          {isProcessing && (
            <span className="ml-2 text-xs text-[var(--viewer-muted-text)]">
              {t("cards.processing", "(Processing...)")}
            </span>
          )}
        </h2>
      </>
    );

    return (
      <div
        className={cn(
          "group/row relative border-b transition-colors",
          "border-[var(--viewer-panel-border)]",
          "hover:bg-[var(--viewer-panel-bg-hover)]",
          "px-2 py-2 sm:px-3",
          isProcessing && "cursor-not-allowed opacity-60",
        )}
        style={sharedStyle}
      >
        <button
          type="button"
          onClick={handleDocumentClick}
          className="absolute inset-0 z-0 cursor-pointer rounded-none border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--viewer-control-border-strong)]"
          disabled={isProcessing}
          aria-label={t("cards.openDocument", {
            name: `${compactShowIndexColumn ? `${indexLabel} ` : ""}${document.name}`,
          })}
        />
        <div className="pointer-events-none relative z-[1] flex items-center justify-between gap-3 sm:hidden">
          {compactShowIndexColumn ? (
            <span className="w-9 shrink-0 text-xs tabular-nums text-[var(--viewer-muted-text)]">
              {indexLabel}
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-3">{nameBlock}</div>
          <div className="flex shrink-0 items-center gap-2">
            {showUpdatedCell ? (
              <p className="max-w-[38vw] truncate text-xs tabular-nums text-[var(--viewer-muted-text)]">
                {timeAgoLocalized(
                  document.versions[0].updatedAt,
                  activeLocale,
                )}
              </p>
            ) : null}
            {compactShowActionsColumn && downloadMenuButton ? (
              <div className="z-10 pointer-events-auto">{downloadMenuButton}</div>
            ) : null}
          </div>
        </div>
        <div
          className={cn(
            "pointer-events-none relative z-[1] hidden items-center gap-3 sm:grid",
            gridClass,
          )}
        >
          {compactShowIndexColumn ? (
            <span className="text-xs tabular-nums text-[var(--viewer-muted-text)]">
              {indexLabel}
            </span>
          ) : null}
          <div className="flex min-w-0 items-center gap-3">{nameBlock}</div>
          {showUpdatedCell ? (
            <p className="truncate text-right text-xs tabular-nums text-[var(--viewer-muted-text)]">
              {timeAgoLocalized(
                document.versions[0].updatedAt,
                activeLocale,
              )}
            </p>
          ) : null}
          {actionsSlot}
        </div>
      </div>
    );
  }

  if (layout === "LIST" && editorialList) {
    const idxLabel =
      document.hierarchicalIndex?.trim() ||
      String(editorialIndex + 1).padStart(2, "0");
    const ver = document.versions[0];
    const sizeLabel = formatEditorialFileSize(ver?.fileSize);
    const typeLabel =
      ver?.type === "notion"
        ? "NOTION"
        : (ver?.type ?? "").replace(/\./g, "").slice(0, 8).toUpperCase() ||
          "FILE";
    const captionLabel = documentFolderLabel || t("cards.documents", "Documents");
    const updatedLabel = showLastUpdated
      ? t("cards.updated", "Updated {{when}}", { when: timeAgoLocalized(ver.updatedAt, activeLocale) })
      : null;

    return (
      <div
        className={cn(
          "group/row relative border-b transition-colors",
          "border-[var(--viewer-panel-border)]",
          "hover:bg-[var(--viewer-panel-bg-hover)]",
          "py-3 pl-2 pr-1 sm:pl-3 sm:pr-2",
          isProcessing && "cursor-not-allowed opacity-60",
        )}
        style={sharedStyle}
      >
        <button
          onClick={handleDocumentClick}
          className="absolute inset-0 z-0 cursor-pointer"
          disabled={isProcessing}
          aria-label={t("cards.openDocument", "Open document {{name}}", { name: document.name })}
        />
        <div className="pointer-events-none relative z-[1] flex flex-col gap-2 md:hidden">
          <div className="flex items-start justify-between gap-3 pl-7">
            <span className="absolute left-2 top-0 text-xs tabular-nums text-[var(--viewer-muted-text)]">
              {idxLabel}
            </span>
            <div className="min-w-0 flex-1">
              <h2
                className="text-sm font-semibold leading-snug text-[var(--viewer-text)]"
                style={HIERARCHICAL_DISPLAY_STYLE}
              >
                {displayNameNode}
              </h2>
              <p className="mt-1 text-xs text-[var(--viewer-muted-text)]">
                {captionLabel}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-[var(--viewer-muted-text)]">
              {updatedLabel ? <span>{updatedLabel}</span> : null}
              <span>{sizeLabel}</span>
              <span className="font-medium">{typeLabel}</span>
            </div>
          </div>
          {downloadMenuButton ? (
            <div className="pointer-events-auto flex justify-end pr-1">
              {downloadMenuButton}
            </div>
          ) : null}
        </div>

        <div className="pointer-events-none relative z-[1] hidden md:grid md:grid-cols-[2rem_minmax(0,1fr)_minmax(6rem,8rem)_4rem_3rem_2.25rem] md:items-center md:gap-4 lg:grid-cols-[2.25rem_minmax(0,1fr)_minmax(7rem,9rem)_4.25rem_3rem_2.25rem]">
          <span className="text-xs tabular-nums text-[var(--viewer-muted-text)]">
            {idxLabel}
          </span>
          <div className="min-w-0">
            <h2
              className="truncate text-sm font-semibold text-[var(--viewer-text)]"
              style={HIERARCHICAL_DISPLAY_STYLE}
            >
              {displayNameNode}
              {isProcessing ? (
                <span className="ml-2 text-xs font-normal text-[var(--viewer-muted-text)]">
                  {t("cards.processing", "(Processing...)")}
                </span>
              ) : null}
            </h2>
            <p className="mt-0.5 truncate text-xs text-[var(--viewer-muted-text)]">
              {captionLabel}
            </p>
          </div>
          <span className="truncate text-right text-xs tabular-nums text-[var(--viewer-muted-text)]">
            {updatedLabel ?? "—"}
          </span>
          <span className="text-right text-xs tabular-nums text-[var(--viewer-muted-text)]">
            {sizeLabel}
          </span>
          <span className="text-center text-[11px] font-medium uppercase tracking-wide text-[var(--viewer-muted-text)]">
            {typeLabel}
          </span>
          <div className="pointer-events-auto flex justify-end">
            {downloadMenuButton ?? (
              <span className="inline-flex h-8 w-8" aria-hidden />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group/row relative flex items-center justify-between rounded-lg border p-3 transition-all sm:p-4",
        "bg-[var(--viewer-panel-bg)] hover:bg-[var(--viewer-panel-bg-hover)]",
        "border-[var(--viewer-panel-border)] hover:border-[var(--viewer-panel-border-hover)]",
        isProcessing && "cursor-not-allowed opacity-60",
      )}
      style={sharedStyle}
    >
      <button
        onClick={handleDocumentClick}
        className="absolute inset-0 z-0 cursor-pointer"
        disabled={isProcessing}
        aria-hidden="true"
      />
      <div className="flex min-w-0 shrink items-center space-x-2 sm:space-x-4">
        <div className="mx-0.5 flex w-8 items-center justify-center text-center sm:mx-1">
          {fileIcon({
            fileType: document.versions[0].type ?? "",
            className: "h-8 w-8",
            isLight,
          })}
        </div>

        <div className="min-w-0 flex-1 flex-col">
          <div className="flex items-center">
            <h2
              className="truncate text-sm font-semibold leading-6 text-[var(--viewer-text)]"
              style={HIERARCHICAL_DISPLAY_STYLE}
            >
              {displayNameNode}
              {isProcessing && (
                <span className="ml-2 text-xs text-[var(--viewer-muted-text)]">
                  {t("cards.processing", "(Processing...)")}
                </span>
              )}
            </h2>
          </div>
          {showLastUpdated && (
            <div className="mt-1 flex items-center space-x-1 text-xs leading-5 text-[var(--viewer-muted-text)]">
              <p className="truncate">
                {t("cards.updated", "Updated {{when}}", {
                  when: timeAgoLocalized(
                    document.versions[0].updatedAt,
                    activeLocale,
                  ),
                })}
              </p>
            </div>
          )}
        </div>
      </div>
      {downloadMenuButton && <div className="z-10">{downloadMenuButton}</div>}
    </div>
  );
}
