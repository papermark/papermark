import { useState } from "react";
import type { CSSProperties } from "react";

import { DataroomFolder } from "@prisma/client";
import { Download, MoreVerticalIcon } from "lucide-react";

import { type DataroomCardLayout } from "@/ee/features/branding/lib/dataroom-viewer-layout";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { getFolderColorClasses, getFolderIcon } from "@/lib/constants/folder-constants";
import { timeAgoLocalized } from "@/lib/i18n/format";
import { asSupportedLocale, DEFAULT_LOCALE } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";
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

type FolderCardProps = {
  folder: DataroomFolder;
  dataroomId: string;
  setFolderId: (id: string) => void;
  isPreview: boolean;
  linkId: string;
  viewId?: string;
  allowDownload: boolean;
  dataroomIndexEnabled?: boolean;
  showLastUpdated?: boolean;
  layout?: DataroomCardLayout;
  hideFolderIcons?: boolean;
  compactShowUpdatedColumn?: boolean;
  compactShowActionsColumn?: boolean;
  /** Strict / compact table: dedicated left column for index */
  compactShowIndexColumn?: boolean;
  editorialList?: boolean;
  editorialIndex?: number;
};
export default function FolderCard({
  folder,
  dataroomId,
  setFolderId,
  isPreview,
  linkId,
  viewId,
  allowDownload,
  dataroomIndexEnabled,
  showLastUpdated = true,
  layout = "LIST",
  hideFolderIcons = false,
  compactShowUpdatedColumn = true,
  compactShowActionsColumn = true,
  compactShowIndexColumn = false,
  editorialList = false,
  editorialIndex = 0,
}: FolderCardProps) {
  const [open, setOpen] = useState(false);
  const { palette } = useViewerSurfaceTheme();
  const { t, i18n } = useTranslation("dataroom");
  const activeLocale = asSupportedLocale(i18n.language) ?? DEFAULT_LOCALE;

  const plainTitle =
    layout === "COMPACT" || (layout === "LIST" && editorialList);
  const hierIndex = folder.hierarchicalIndex?.trim() || "";
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
  const displayName =
    plainTitle || !inlineIndexPrefix
      ? folder.name
      : `${inlineIndexPrefix} ${folder.name}`;
  // Kept as a JSX node so we can render two spans inline without losing the
  // `truncate` behaviour, even though both spans use the same color.
  const displayNameNode =
    plainTitle || !inlineIndexPrefix ? (
      folder.name
    ) : (
      <>
        <span>{inlineIndexPrefix}</span> {folder.name}
      </>
    );
  const openFolderDownloadModal = () => {
    if (!allowDownload) {
      toast.error(t("navToasts.foldersNotAllowed", "Downloading folders is not allowed."));
      return;
    }
    if (isPreview) {
      toast.error(t("navToasts.cannotDownloadFolderPreview", "You cannot download dataroom folders in preview mode."));
      return;
    }

    window.dispatchEvent(
      new CustomEvent("viewer-download-modal-open", {
        detail: { folderId: folder.id, folderName: folder.name },
      }),
    );
  };

  const FolderIconComponent = getFolderIcon(folder.icon);
  const colorClasses = hideFolderIcons ? null : getFolderColorClasses(folder.color);

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
  } as CSSProperties;

  const downloadMenuButton = allowDownload && (
    <DropdownMenu open={open} onOpenChange={setOpen}>
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
            openFolderDownloadModal();
            setOpen(false);
          }}
          disabled={isPreview}
        >
          <Download className="h-4 w-4" />
          {t("cards.download", "Download")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (layout === "GRID") {
    // Compact row tile — folders share the grid with documents but stay short;
    // the viewer uses a tighter 3-column grid for folder runs only.
    //
    // Click-through pattern: the underlying <button> covers the entire card
    // (absolute inset-0) so the full surface is clickable, including hover
    // over the icon and name. The content layer uses pointer-events-none so
    // clicks pass through to the button, and the download menu re-enables
    // pointer events only on itself.
    return (
      <div
        className={cn(
          "group/row relative flex min-h-0 cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-all sm:px-3 sm:py-2.5",
          "bg-[var(--viewer-panel-bg)] hover:bg-[var(--viewer-panel-bg-hover)]",
          "border-[var(--viewer-panel-border)] hover:border-[var(--viewer-panel-border-hover)]",
        )}
        style={sharedStyle}
      >
        <button
          onClick={() => setFolderId(folder.id)}
          className="absolute inset-0 z-0 cursor-pointer"
          aria-label={t("cards.openFolder", "Open folder {{name}}", { name: folder.name })}
        />
        <div className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2">
          {!hideFolderIcons && colorClasses ? (
            <FolderIconComponent
              className={`h-7 w-7 shrink-0 sm:h-8 sm:w-8 ${colorClasses.iconClass}`}
              strokeWidth={1}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <h2
              className="truncate text-sm font-medium leading-tight text-[var(--viewer-text)] sm:leading-5"
              style={HIERARCHICAL_DISPLAY_STYLE}
            >
              {displayNameNode}
            </h2>
            {showLastUpdated && (
              <p className="truncate text-xs leading-4 text-[var(--viewer-muted-text)]">
                {t("cards.updated", "Updated {{when}}", {
                  when: timeAgoLocalized(folder.updatedAt, activeLocale),
                })}
              </p>
            )}
          </div>
        </div>
        {downloadMenuButton && (
          <div className="pointer-events-auto relative z-10 shrink-0">
            {downloadMenuButton}
          </div>
        )}
      </div>
    );
  }

  if (layout === "COMPACT") {
    const indexLabel =
      folder.hierarchicalIndex?.trim() ||
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

    const iconEl =
      !hideFolderIcons && colorClasses ? (
        <FolderIconComponent
          className={`h-5 w-5 shrink-0 ${colorClasses.iconClass}`}
          strokeWidth={1.5}
        />
      ) : null;

    const nameBlock = (
      <>
        {iconEl}
        <h2
          className="truncate text-sm font-medium leading-5 text-[var(--viewer-text)]"
          style={HIERARCHICAL_DISPLAY_STYLE}
        >
          {displayNameNode}
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
        )}
        style={sharedStyle}
      >
        <button
          type="button"
          onClick={() => setFolderId(folder.id)}
          className="absolute inset-0 z-0 cursor-pointer rounded-none border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--viewer-control-border-strong)]"
          aria-label={t("cards.openFolder", {
            name: `${compactShowIndexColumn ? `${indexLabel} ` : ""}${folder.name}`,
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
                {timeAgoLocalized(folder.updatedAt, activeLocale)}
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
              {timeAgoLocalized(folder.updatedAt, activeLocale)}
            </p>
          ) : null}
          {actionsSlot}
        </div>
      </div>
    );
  }

  if (layout === "LIST" && editorialList) {
    const idxLabel =
      folder.hierarchicalIndex?.trim() ||
      String(editorialIndex + 1).padStart(2, "0");
    const updatedLabel = showLastUpdated
      ? t("cards.updated", "Updated {{when}}", {
          when: timeAgoLocalized(folder.updatedAt, activeLocale),
        })
      : null;

    return (
      <div
        className={cn(
          "group/row relative border-b transition-colors",
          "border-[var(--viewer-panel-border)]",
          "hover:bg-[var(--viewer-panel-bg-hover)]",
          "py-3 pl-2 pr-1 sm:pl-3 sm:pr-2",
        )}
        style={sharedStyle}
      >
        <button
          onClick={() => setFolderId(folder.id)}
          className="absolute inset-0 z-0 cursor-pointer"
          aria-label={t("cards.openFolder", "Open folder {{name}}", { name: folder.name })}
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
                {t("cards.folder", "Folder")}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-[var(--viewer-muted-text)]">
              {updatedLabel ? <span>{updatedLabel}</span> : null}
              <span className="font-medium">{t("cards.folderBadge", "FOLDER")}</span>
            </div>
          </div>
          {downloadMenuButton ? (
            <div className="pointer-events-auto flex justify-end pr-1">
              {downloadMenuButton}
            </div>
          ) : null}
        </div>

        <div className="pointer-events-none relative z-[1] hidden md:grid md:grid-cols-[2rem_minmax(0,1fr)_minmax(6rem,8rem)_3rem_2.25rem] md:items-center md:gap-4 lg:grid-cols-[2.25rem_minmax(0,1fr)_minmax(7rem,9rem)_3rem_2.25rem]">
          <span className="text-xs tabular-nums text-[var(--viewer-muted-text)]">
            {idxLabel}
          </span>
          <div className="min-w-0">
            <h2
              className="truncate text-sm font-semibold text-[var(--viewer-text)]"
              style={HIERARCHICAL_DISPLAY_STYLE}
            >
              {displayNameNode}
            </h2>
            <p className="mt-0.5 truncate text-xs text-[var(--viewer-muted-text)]">
              {t("cards.folder", "Folder")}
            </p>
          </div>
          <span className="truncate text-right text-xs tabular-nums text-[var(--viewer-muted-text)]">
            {updatedLabel ?? "—"}
          </span>
          <span className="text-center text-[11px] font-medium uppercase tracking-wide text-[var(--viewer-muted-text)]">
            {t("cards.folderBadge", "FOLDER")}
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
      )}
      style={sharedStyle}
    >
      <button
        onClick={() => setFolderId(folder.id)}
        className="absolute inset-0 z-0 cursor-pointer"
        aria-hidden="true"
      />
      <div className="flex min-w-0 shrink items-center space-x-2 sm:space-x-4">
        {!hideFolderIcons && colorClasses ? (
          <div className="mx-0.5 flex w-8 items-center justify-center text-center sm:mx-1">
            <FolderIconComponent
              className={`h-8 w-8 ${colorClasses.iconClass}`}
              strokeWidth={1}
            />
          </div>
        ) : null}

        <div className="min-w-0 flex-1 flex-col">
          <div className="flex items-center">
            <h2
              className="truncate text-sm font-semibold leading-6 text-[var(--viewer-text)]"
              style={HIERARCHICAL_DISPLAY_STYLE}
            >
              {displayNameNode}
            </h2>
          </div>
          {showLastUpdated && (
            <div className="mt-1 flex items-center space-x-1 text-xs leading-5 text-[var(--viewer-muted-text)]">
              <p className="truncate">
                {t("cards.updated", "Updated {{when}}", {
                  when: timeAgoLocalized(folder.updatedAt, activeLocale),
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
