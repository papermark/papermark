import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

import { useViewerSurfaceTheme } from "@/components/view/viewer/viewer-surface-theme";

/**
 * Shared grid template for compact (Strict) table header + rows.
 *
 * IMPORTANT: classes must be literal strings so Tailwind's JIT picks them up
 * during build. Do NOT build `sm:grid-cols-[…]` via string interpolation —
 * the generated CSS will be missing and the row collapses to a single column.
 */
export function compactDataroomListGridClass(
  showUpdatedColumn: boolean,
  showSettingsColumn: boolean,
  showIndexColumn = false,
): string {
  if (showIndexColumn && showUpdatedColumn && showSettingsColumn) {
    return "sm:grid-cols-[minmax(2rem,2.75rem)_minmax(0,1fr)_minmax(7rem,auto)_2.5rem]";
  }
  if (showIndexColumn && showUpdatedColumn) {
    return "sm:grid-cols-[minmax(2rem,2.75rem)_minmax(0,1fr)_minmax(7rem,auto)]";
  }
  if (showIndexColumn && showSettingsColumn) {
    return "sm:grid-cols-[minmax(2rem,2.75rem)_minmax(0,1fr)_2.5rem]";
  }
  if (showIndexColumn) {
    return "sm:grid-cols-[minmax(2rem,2.75rem)_minmax(0,1fr)]";
  }
  if (showUpdatedColumn && showSettingsColumn) {
    return "sm:grid-cols-[minmax(0,1fr)_minmax(7rem,auto)_2.5rem]";
  }
  if (showUpdatedColumn) {
    return "sm:grid-cols-[minmax(0,1fr)_minmax(7rem,auto)]";
  }
  if (showSettingsColumn) {
    return "sm:grid-cols-[minmax(0,1fr)_2.5rem]";
  }
  return "sm:grid-cols-[minmax(0,1fr)]";
}

export function CompactDataroomListHeader({
  showUpdatedColumn,
  showSettingsColumn,
  showIndexColumn = false,
  className,
}: {
  showUpdatedColumn: boolean;
  showSettingsColumn: boolean;
  showIndexColumn?: boolean;
  className?: string;
}) {
  const { palette } = useViewerSurfaceTheme();
  const { t } = useTranslation("dataroom");

  return (
    <div
      role="row"
      aria-hidden
      className={cn(
        "hidden items-center gap-3 border-b px-2 py-2 text-xs font-medium tabular-nums sm:grid sm:px-3",
        compactDataroomListGridClass(
          showUpdatedColumn,
          showSettingsColumn,
          showIndexColumn,
        ),
        className,
      )}
      style={{
        backgroundColor: palette.controlBgColor,
        borderColor: palette.panelBorderColor,
        color: palette.mutedTextColor,
      }}
    >
      {showIndexColumn ? (
        <div className="text-left tabular-nums opacity-80">#</div>
      ) : null}
      <div>{t("compactList.name", "Name")}</div>
      {showUpdatedColumn ? (
        <div className="text-right sm:text-right">
          {t("compactList.updated", "Updated")}
        </div>
      ) : null}
      {showSettingsColumn ? (
        <div className="text-center">{t("compactList.settings", "Settings")}</div>
      ) : null}
    </div>
  );
}
