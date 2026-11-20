import { BadgeInfoIcon, Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { determineTextColor } from "@/lib/utils/determine-text-color";

import { ButtonTooltip } from "@/components/ui/tooltip";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { Button } from "../../ui/button";

export type DataroomTrailingActionsVariant = "onBrand" | "onLight";

/**
 * Trailing action buttons that historically lived in the dataroom navbar
 * (team-member info badge, CTA, conversations toggle, bulk download).
 *
 * Extracted into a standalone component so the Notion preset — which has no
 * navbar above the cover image — can render the same buttons inside the body
 * toolbar on the right of the search input.
 *
 * Stateful behavior (conversations open/close, download modal) lives in
 * `nav-dataroom`. To keep this component decoupled, callers pass the click
 * handlers; from the body toolbar those handlers dispatch CustomEvents that
 * the nav listens for.
 */
export function DataroomTrailingActions({
  variant = "onBrand",
  isTeamMember,
  brand,
  conversationsEnabled,
  allowDownload,
  allowBulkDownload,
  viewerEmail,
  isPreview,
  onToggleConversations,
  onOpenDownload,
}: {
  variant?: DataroomTrailingActionsVariant;
  isTeamMember?: boolean;
  brand?: {
    ctaLabel?: string | null;
    ctaUrl?: string | null;
    brandColor?: string | null;
    accentButtonColor?: string | null;
  } | null;
  conversationsEnabled?: boolean;
  allowDownload?: boolean;
  allowBulkDownload?: boolean;
  viewerEmail?: string | null;
  isPreview?: boolean;
  onToggleConversations: () => void;
  onOpenDownload: () => void;
}) {
  const { t } = useTranslation("dataroom");
  const showNavCta = !!brand?.ctaLabel && !!brand?.ctaUrl;

  // "onLight" picks up the surface-aware viewer CSS vars so the button blends
  // with whatever background the dataroom view is rendering against (white,
  // brand accent, light or dark). "onBrand" stays dark because it sits on
  // the brand-colored navbar.
  const chip =
    variant === "onLight"
      ? "border border-[var(--viewer-control-border)] bg-[var(--viewer-control-bg)] text-[var(--viewer-text)] hover:bg-[var(--viewer-panel-bg-hover)] hover:text-[var(--viewer-text)]"
      : "border border-transparent bg-gray-900 text-white hover:bg-gray-900/80";

  return (
    <>
      {isTeamMember ? (
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button className={cn("size-8 sm:size-10", chip)} size="icon">
                <BadgeInfoIcon className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs text-wrap text-center">
                {t("trailingActions.teamMemberTooltip", "Skipped verification because you are a team member; no analytics will be collected")}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
      {showNavCta && (
        <a
          href={brand!.ctaUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors hover:opacity-90"
          style={{
            backgroundColor:
              brand?.accentButtonColor || brand?.brandColor || "#111827",
            color: determineTextColor(
              brand?.accentButtonColor || brand?.brandColor || "#111827",
            ),
          }}
        >
          {brand!.ctaLabel}
        </a>
      )}
      {conversationsEnabled && (
        <Button
          onClick={onToggleConversations}
          variant={variant === "onLight" ? "outline" : "default"}
          className={cn(
            variant === "onLight" &&
              "border-[var(--viewer-control-border)] bg-[var(--viewer-control-bg)] text-[var(--viewer-text)] hover:bg-[var(--viewer-panel-bg-hover)] hover:text-[var(--viewer-text)]",
            variant === "onBrand" &&
              "bg-gray-900 text-white hover:bg-gray-900/90",
          )}
        >
          {t("trailingActions.viewQA", "View Q&A")}
        </Button>
      )}
      {allowDownload && allowBulkDownload && (viewerEmail || isPreview) ? (
        <ButtonTooltip content={t("trailingActions.downloadDataroom", "Download Dataroom")}>
          <Button
            onClick={onOpenDownload}
            className={cn("m-1 size-9 sm:size-10", chip)}
            size="icon"
          >
            <Download className="h-5 w-5" />
          </Button>
        </ButtonTooltip>
      ) : null}
    </>
  );
}

/** Event names dispatched by external callers (e.g. the body toolbar in
 *  Notion mode) and listened for by `nav-dataroom` to mutate its local
 *  state without prop-drilling. */
export const VIEWER_TOGGLE_CONVERSATIONS_EVENT = "viewer-conversation-toggle";
export const VIEWER_OPEN_DOWNLOAD_EVENT = "viewer-download-modal-open";
