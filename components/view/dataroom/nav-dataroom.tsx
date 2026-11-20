import Link from "next/link";

import React, { useEffect, useMemo, useState } from "react";

import { useViewerChatSafe } from "@/ee/features/ai/components/viewer-chat-provider";
import { resolveBrandLogo } from "@/ee/features/branding/lib/brand-logo";
import { classifyDataroomBanner } from "@/ee/features/branding/lib/dataroom-banner";
import {
  type DataroomViewerHeaderStyle,
  asDataroomViewerHeaderStyle,
} from "@/ee/features/branding/lib/dataroom-viewer-layout";
import { useLogoTone } from "@/ee/features/branding/lib/use-logo-tone";
import { useConversationSidebarSafe } from "@/ee/features/conversations/components/viewer/conversation-sidebar-provider";
import { RequestListSheet } from "@/ee/features/request-lists/components/viewer/request-list-sheet";
import { VIEWER_TOGGLE_REQUEST_LIST_EVENT } from "@/ee/features/request-lists/lib/events";
import { useViewerRequestList } from "@/ee/features/request-lists/lib/swr/use-viewer-request-list";
import { DataroomBrand } from "@prisma/client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { formatDateLocalized } from "@/lib/i18n/format";
import { DEFAULT_LOCALE, asSupportedLocale } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";

import { ConversationSidebar } from "../conversations/sidebar";
import { createViewerSurfaceTheme } from "../viewer/viewer-surface-theme";
import { DataroomBannerMedia } from "./dataroom-banner-media";
import {
  DataroomTrailingActions,
  VIEWER_OPEN_DOWNLOAD_EVENT,
  VIEWER_TOGGLE_CONVERSATIONS_EVENT,
} from "./dataroom-trailing-actions";
import { ViewerDownloadProgressModal } from "./viewer-download-progress-modal";

const DEFAULT_BANNER_IMAGE = "/_static/papermark-banner.png";

/** Matches dataroom viewer main column padding so headers align with the
 *  document area below (see dataroom-viewer.tsx main content padding). */
const DATAROOM_NAV_PAGE_FRAME = "mx-auto w-full px-3 md:px-6 lg:px-8 xl:px-14";

/**
 * Notion-preset cover logo chip. Picks a contrasting background behind the
 * logo based on the logo's averaged pixel luminance: dark logo → white box,
 * light/white logo → black box. Falls back to a white box while the image is
 * still loading or when the image host doesn't allow CORS pixel reads.
 */
function NotionLogoChip({
  src,
  usesSurfaceBackground,
  surfacePanelBorderColor,
}: {
  src: string;
  usesSurfaceBackground: boolean;
  surfacePanelBorderColor: string;
}) {
  const { tone, imgProps } = useLogoTone(src);
  // Default to "dark" (i.e. white chip) so the chip is white before analysis
  // completes — most logos are designed for white backgrounds, so this avoids
  // a black flash on first load.
  const isLightLogo = tone === "light";
  return (
    <div
      className={cn(
        "flex size-16 items-center justify-center overflow-hidden rounded-xl border p-2 shadow-sm sm:size-20",
        isLightLogo
          ? "border-neutral-800 bg-neutral-950"
          : "border-neutral-200 bg-white",
      )}
      style={
        usesSurfaceBackground
          ? { borderColor: surfacePanelBorderColor }
          : undefined
      }
    >
      {/* The display <img> doubles as the source for `useLogoTone`'s canvas
          analysis — `crossOrigin` keeps the canvas read untainted and lets
          the hook reuse this single decode instead of fetching a second
          Image() over the wire. */}
      <img
        className="h-full w-full object-contain"
        src={src}
        alt=""
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        {...imgProps}
      />
    </div>
  );
}

export default function DataroomNav({
  allowDownload,
  allowBulkDownload,
  brand,
  viewId,
  linkId,
  dataroom,
  isPreview,
  dataroomId,
  viewerId,
  viewerEmail,
  conversationsEnabled,
  isTeamMember,
  viewerHeaderStyle: viewerHeaderStyleProp,
  topBarBreadcrumb,
  topBarSearch,
  topBarTrailingActions,
  surfaceBackgroundColor,
}: {
  allowDownload?: boolean;
  allowBulkDownload?: boolean;
  brand?: Partial<DataroomBrand>;
  viewId?: string;
  linkId?: string;
  dataroom?: any;
  isPreview?: boolean;
  dataroomId?: string;
  viewerId?: string;
  viewerEmail?: string | null;
  conversationsEnabled?: boolean;
  isTeamMember?: boolean;
  viewerHeaderStyle?: DataroomViewerHeaderStyle;
  /** Modern (SPLIT) header: optional breadcrumb rendered above the inner separator. */
  topBarBreadcrumb?: React.ReactNode;
  /** Modern (SPLIT) header: optional search box rendered alongside the breadcrumb. */
  topBarSearch?: React.ReactNode;
  /** Modern (SPLIT) header: optional action buttons (Generate Index, Add
   *  Document, etc.) rendered next to the search input on the same line so
   *  the toolbar mirrors what Standard renders in its body toolbar. */
  topBarTrailingActions?: React.ReactNode;
  /** Optional surface bg color (e.g. brand accent) applied to SPLIT / NOTION
   *  header so it matches the body when accent color is enabled. */
  surfaceBackgroundColor?: string | null;
}) {
  const { t, i18n } = useTranslation("dataroom");
  // Lock the formatter to the active i18next language so dates re-render when
  // the visitor uses the language switcher without forcing a full page reload.
  const activeLocale = asSupportedLocale(i18n.language) ?? DEFAULT_LOCALE;
  const [showConversations, setShowConversations] = useState<boolean>(false);
  const [showRequestList, setShowRequestList] = useState<boolean>(false);
  const [showDownloadModal, setShowDownloadModal] = useState<boolean>(false);
  const [downloadModalJobId, setDownloadModalJobId] = useState<string | null>(
    null,
  );
  const [downloadFolderId, setDownloadFolderId] = useState<string | null>(null);
  const [downloadFolderName, setDownloadFolderName] = useState<string | null>(
    null,
  );

  // Detect whether this dataroom exposes a request list to the current viewer.
  // Session-verified GET; only runs for real (non-preview) verified visitors.
  // SWR dedupes with the toolbar button's detection so there's one request.
  const { enabled: requestListEnabled } = useViewerRequestList({
    linkId,
    dataroomId,
    viewerId,
    isPreview,
  });

  // The AI chat and Q&A sidebar each shift the body content by padding it. The
  // banner lives in the nav (above the body), so shift it in lockstep here so
  // the whole page below the top bar moves together while the top bar stays put.
  const conversationSidebar = useConversationSidebarSafe();
  const chat = useViewerChatSafe();
  const panelOpen =
    !!conversationSidebar?.isOpen || !!(chat?.isOpen && chat?.isEnabled);
  const bannerShiftClass = cn(
    "transition-[padding] duration-300 ease-in-out",
    panelOpen && "pr-[400px]",
  );

  // Derive downloads page URL from current path so it works for both
  // /view/<linkId>/downloads and /<slug>/downloads (custom domains)
  const downloadsPageUrl = useMemo(() => {
    if (typeof window === "undefined") return "/downloads";
    const path = window.location.pathname.replace(/\/+$/, "");
    return `${path}/downloads`;
  }, []);

  useEffect(() => {
    const handler = (
      e: CustomEvent<{
        jobId?: string;
        folderId?: string;
        folderName?: string;
      }>,
    ) => {
      setDownloadModalJobId(e.detail?.jobId ?? null);
      setDownloadFolderId(e.detail?.folderId ?? null);
      setDownloadFolderName(e.detail?.folderName ?? null);
      setShowDownloadModal(true);
    };
    window.addEventListener(
      VIEWER_OPEN_DOWNLOAD_EVENT as any,
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        VIEWER_OPEN_DOWNLOAD_EVENT as any,
        handler as EventListener,
      );
  }, []);

  // Notion preset has no navbar, so its trailing buttons live in the body
  // toolbar (next to the search). The body toolbar dispatches this event when
  // the user clicks the conversations button; we honor it here so the
  // sidebar state stays owned by the nav and we don't need to lift it.
  useEffect(() => {
    const handler = () => setShowConversations((prev) => !prev);
    window.addEventListener(
      VIEWER_TOGGLE_CONVERSATIONS_EVENT as any,
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        VIEWER_TOGGLE_CONVERSATIONS_EVENT as any,
        handler as EventListener,
      );
  }, []);

  // The Request List trigger button lives in the viewer body toolbar (next to
  // Add document / Search / Introduction). It dispatches this event so the
  // sheet state stays owned by the nav without prop-drilling the handler.
  useEffect(() => {
    const handler = () => setShowRequestList((prev) => !prev);
    window.addEventListener(
      VIEWER_TOGGLE_REQUEST_LIST_EVENT as any,
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        VIEWER_TOGGLE_REQUEST_LIST_EVENT as any,
        handler as EventListener,
      );
  }, []);

  const openDownloadModal = () => {
    if (isPreview) {
      toast.error(
        t(
          "navToasts.cannotDownloadPreview",
          "You cannot download datarooms in preview mode.",
        ),
      );
      return;
    }
    if (!allowDownload || !allowBulkDownload) return;
    if (!viewerEmail) {
      toast.error(
        t(
          "navToasts.enterEmailFirst",
          "Enter your email in the dataroom to download.",
        ),
      );
      return;
    }
    setDownloadModalJobId(null);
    setDownloadFolderId(null);
    setDownloadFolderName(null);
    setShowDownloadModal(true);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle conversations with 'c' key
      if (
        e.key === "c" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        conversationsEnabled &&
        !showConversations // if conversations are already open, don't toggle them
      ) {
        e.preventDefault();
        setShowConversations((prev) => !prev);
      }

      if (e.key === "Escape" && showConversations) {
        e.preventDefault();
        setShowConversations(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [conversationsEnabled, showConversations]);

  const hasBanner = brand?.banner !== "no-banner";
  const viewerHeaderStyle: DataroomViewerHeaderStyle =
    asDataroomViewerHeaderStyle(
      (brand as { viewerHeaderStyle?: string } | undefined)
        ?.viewerHeaderStyle ?? viewerHeaderStyleProp,
    );
  const headerMode: "DEFAULT" | "SPLIT" | "NOTION" =
    hasBanner && dataroom?.name
      ? viewerHeaderStyle === "SPLIT" || viewerHeaderStyle === "NOTION"
        ? viewerHeaderStyle
        : "DEFAULT"
      : "DEFAULT";

  const bannerSrc = brand?.banner || DEFAULT_BANNER_IMAGE;

  // Video / YouTube banners only play inside Modern's boxed banner slot. The
  // Default and Notion banners stretch full-width which makes inline video
  // playback awkward (the player gets distorted across very wide aspect
  // ratios), so for those layouts we substitute the brand's default banner
  // image. Modern keeps the original `bannerSrc` to actually play the video.
  const bannerKind = classifyDataroomBanner(bannerSrc).kind;
  const fullBleedBannerSrc =
    bannerKind === "video" || bannerKind === "youtube"
      ? DEFAULT_BANNER_IMAGE
      : bannerSrc;
  const resolvedBrandLogo = resolveBrandLogo(brand);

  // The brand logo is rendered without a wrapper card so it sits naturally on
  // the surface — uploaded logos are typically designed to read on the brand's
  // chosen background and shouldn't be boxed in a contrasting chip.
  const renderPrimaryLogo = (forLightBackground?: boolean) => {
    switch (resolvedBrandLogo.kind) {
      case "custom":
        return (
          <img
            className="h-10 w-28 object-contain sm:h-12 sm:w-32"
            src={resolvedBrandLogo.src}
            alt="Logo"
          />
        );
      case "papermark":
        return (
          <Link
            href={`https://www.papermark.com?utm_campaign=navbar&utm_medium=navbar&utm_source=papermark-${linkId}`}
            target="_blank"
            className={cn(
              "text-2xl font-bold tracking-tighter",
              forLightBackground
                ? "text-neutral-900 dark:text-white"
                : "text-white",
            )}
          >
            Papermark
          </Link>
        );
      case "none":
        return null;
      default: {
        const _exhaustive: never = resolvedBrandLogo;
        return _exhaustive;
      }
    }
  };

  const welcomeMessage =
    (brand as { welcomeMessage?: string | null })?.welcomeMessage?.trim() ||
    null;

  const eyebrowLine = useMemo(() => {
    const parts = [t("shell.dataRoomEyebrow", "Data room")];
    if (dataroom?.showLastUpdated && dataroom?.lastUpdatedAt) {
      parts.push(
        t("shell.updatedOn", "Updated {{date}}", {
          date: formatDateLocalized(dataroom.lastUpdatedAt, activeLocale),
        }),
      );
    }
    return parts.join(" · ").toUpperCase();
  }, [dataroom?.showLastUpdated, dataroom?.lastUpdatedAt, activeLocale, t]);

  const renderToolbarTrailing = (
    variant: "onBrand" | "onLight" = "onBrand",
  ) => (
    <DataroomTrailingActions
      variant={variant}
      isTeamMember={isTeamMember}
      brand={
        brand
          ? {
              ctaLabel: brand.ctaLabel ?? null,
              ctaUrl: brand.ctaUrl ?? null,
              brandColor: brand.brandColor ?? null,
              accentButtonColor:
                (brand as { accentButtonColor?: string | null })
                  ?.accentButtonColor ?? null,
            }
          : null
      }
      conversationsEnabled={conversationsEnabled}
      allowDownload={allowDownload}
      allowBulkDownload={allowBulkDownload}
      viewerEmail={viewerEmail}
      isPreview={isPreview}
      onToggleConversations={() => setShowConversations(!showConversations)}
      onOpenDownload={openDownloadModal}
    />
  );

  const usesSurfaceBackground =
    !!surfaceBackgroundColor && surfaceBackgroundColor !== "#ffffff";

  // Adaptive palette mirrors the body so SPLIT (Modern) header text reads
  // correctly on any accent color picked in branding.
  const surfaceTheme = useMemo(
    () => createViewerSurfaceTheme(surfaceBackgroundColor ?? null),
    [surfaceBackgroundColor],
  );
  const surfaceTextStyle = usesSurfaceBackground
    ? { color: surfaceTheme.palette.textColor }
    : undefined;
  const surfaceMutedTextStyle = usesSurfaceBackground
    ? { color: surfaceTheme.palette.mutedTextColor }
    : undefined;
  // Expose the adaptive palette as CSS vars so children that consume the same
  // `--viewer-*` tokens as the body (breadcrumb, search, separators) adapt to
  // the accent color in Modern (SPLIT) just like the DEFAULT body does.
  const splitSurfaceVars = useMemo<React.CSSProperties>(
    () =>
      ({
        "--viewer-text": surfaceTheme.palette.textColor,
        "--viewer-muted-text": surfaceTheme.palette.mutedTextColor,
        "--viewer-subtle-text": surfaceTheme.palette.subtleTextColor,
        "--viewer-panel-bg": surfaceTheme.palette.panelBgColor,
        "--viewer-panel-bg-hover": surfaceTheme.palette.panelHoverBgColor,
        "--viewer-panel-border": surfaceTheme.palette.panelBorderColor,
        "--viewer-panel-border-hover":
          surfaceTheme.palette.panelBorderHoverColor,
        "--viewer-control-bg": surfaceTheme.palette.controlBgColor,
        "--viewer-control-border": surfaceTheme.palette.controlBorderColor,
        "--viewer-control-border-strong":
          surfaceTheme.palette.controlBorderStrongColor,
        "--viewer-control-icon": surfaceTheme.palette.controlIconColor,
        "--viewer-placeholder": surfaceTheme.palette.controlPlaceholderColor,
        // Brand accent passes through to nav children (breadcrumb leaf renders
        // inside the nav in Modern, so we surface the var here too).
        "--viewer-accent":
          (brand as any)?.accentButtonColor ||
          brand?.brandColor ||
          surfaceTheme.palette.textColor,
      }) as React.CSSProperties,
    [surfaceTheme, brand],
  );
  const notionLogoSrc = (() => {
    switch (resolvedBrandLogo.kind) {
      case "custom":
        return resolvedBrandLogo.src;
      case "papermark":
        return "/_static/papermark-p.svg";
      case "none":
        return null;
      default: {
        const _exhaustive: never = resolvedBrandLogo;
        return _exhaustive;
      }
    }
  })();

  return (
    <nav
      className={cn(
        headerMode === "SPLIT"
          ? cn(
              "border-b border-[var(--viewer-panel-border)] text-neutral-900 dark:text-neutral-100",
              usesSurfaceBackground ? "" : "bg-white dark:bg-neutral-950",
            )
          : "bg-black",
      )}
      style={
        headerMode === "SPLIT"
          ? {
              ...splitSurfaceVars,
              ...(usesSurfaceBackground
                ? { backgroundColor: surfaceBackgroundColor as string }
                : {}),
            }
          : {
              backgroundColor:
                brand && brand.brandColor ? brand.brandColor : "black",
            }
      }
    >
      {headerMode === "NOTION" && hasBanner ? (
        <div className={bannerShiftClass}>
          {/* Notion has no persistent top bar (the banner is the top of the
              page), so a zero-height marker at y=0 makes the panel fill the
              full height instead of leaving a top-bar-sized gap. */}
          <div aria-hidden data-viewer-top-bar className="h-0" />
          {/* Notion layout: no brand-colored navbar above the cover — the
              banner is the top of the page (Notion convention). The nav's
              trailing buttons (CTA, conversations, download) are hoisted into
              the body toolbar (right of the search input) by
              `dataroom-viewer.tsx` and reach back here via the
              `viewer-conversation-toggle` and `viewer-download-modal-open`
              custom events. */}
          <div className="relative h-[20vh] w-full overflow-hidden bg-neutral-100 dark:bg-neutral-900 sm:h-auto sm:max-h-80">
            <DataroomBannerMedia
              src={fullBleedBannerSrc}
              className="h-full w-full object-cover sm:max-h-80 sm:object-contain xl:object-cover"
            />
          </div>
          <div
            className={cn(
              "text-black dark:text-white",
              usesSurfaceBackground ? "" : "bg-white dark:bg-neutral-950",
            )}
            style={
              usesSurfaceBackground
                ? {
                    ...splitSurfaceVars,
                    backgroundColor: surfaceBackgroundColor as string,
                  }
                : splitSurfaceVars
            }
          >
            <div className={cn(DATAROOM_NAV_PAGE_FRAME, "pb-10 pt-2")}>
              {/* The chip overlaps the cover, so with no chip the negative
                  margin has to go or the dataroom name rides up onto it. */}
              <div
                className={cn(
                  "relative z-10 flex w-full flex-col items-start text-left",
                  notionLogoSrc && "-mt-10 sm:-mt-12",
                )}
              >
                {notionLogoSrc ? (
                  <NotionLogoChip
                    src={notionLogoSrc}
                    usesSurfaceBackground={usesSurfaceBackground}
                    surfacePanelBorderColor={
                      surfaceTheme.palette.panelBorderColor
                    }
                  />
                ) : null}
                <div
                  className={cn("max-w-3xl text-3xl", notionLogoSrc && "mt-4")}
                  style={surfaceTextStyle}
                >
                  {dataroom.name}
                </div>
                {dataroom.showLastUpdated ? (
                  <time
                    className="mt-0.5 block text-sm text-neutral-600 dark:text-neutral-400"
                    style={surfaceMutedTextStyle}
                    dateTime={new Date(dataroom.lastUpdatedAt).toISOString()}
                  >
                    {t("shell.lastUpdated", "Last updated {{date}}", {
                      date: formatDateLocalized(
                        dataroom.lastUpdatedAt,
                        activeLocale,
                      ),
                    })}
                  </time>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : headerMode === "SPLIT" && hasBanner ? (
        <>
          <div
            className={cn(DATAROOM_NAV_PAGE_FRAME, "pt-4")}
            style={splitSurfaceVars}
          >
            <div
              data-viewer-top-bar
              className="flex items-center justify-between gap-2 border-b border-[var(--viewer-panel-border)] pb-2"
            >
              <div className="relative flex min-h-14 min-w-0 shrink-0 items-center overflow-y-hidden">
                {renderPrimaryLogo(true)}
              </div>
              <div className="flex min-w-0 shrink items-center justify-end gap-2">
                {renderToolbarTrailing("onLight")}
              </div>
            </div>

            <div className={bannerShiftClass}>
              <div className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,40%)] lg:items-center lg:gap-8 lg:py-6">
                <div className="min-w-0 space-y-2">
                  <p
                    className="text-[11px] font-medium uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400"
                    style={surfaceMutedTextStyle}
                  >
                    {eyebrowLine}
                  </p>
                  <h1
                    className="text-balance text-3xl text-neutral-950 dark:text-white"
                    style={surfaceTextStyle}
                  >
                    {dataroom.name}
                  </h1>
                  {welcomeMessage ? (
                    <p
                      className="max-w-2xl text-pretty text-sm leading-relaxed text-neutral-600 dark:text-neutral-300"
                      style={surfaceMutedTextStyle}
                    >
                      {welcomeMessage}
                    </p>
                  ) : null}
                </div>
                <div className="relative aspect-[16/7] w-full overflow-hidden rounded-xl border border-neutral-200/90 bg-neutral-200/30 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 lg:aspect-[16/9]">
                  <div className="absolute inset-0">
                    <DataroomBannerMedia src={bannerSrc} alt="" />
                  </div>
                </div>
              </div>

              {topBarBreadcrumb || topBarSearch || topBarTrailingActions ? (
                <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    {topBarBreadcrumb}
                  </div>
                  {/* Right cluster: search + trailing actions live on the same
                    line so Modern's toolbar mirrors the Standard body toolbar
                    (search + Generate Index + Add Document together). On
                    mobile, this wraps so the buttons drop below the search
                    instead of overflowing the row. */}
                  {topBarSearch || topBarTrailingActions ? (
                    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:flex-nowrap sm:gap-x-2">
                      {topBarSearch ? (
                        <div className="w-full min-w-0 sm:w-72 sm:min-w-[12rem] sm:max-w-sm sm:flex-none">
                          {topBarSearch}
                        </div>
                      ) : null}
                      {topBarTrailingActions}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <>
          <div data-viewer-top-bar className={DATAROOM_NAV_PAGE_FRAME}>
            <div className="relative flex h-16 items-center justify-between">
              <div className="flex flex-1 items-center justify-start">
                <div className="relative flex h-16 w-36 flex-shrink-0 items-center">
                  {renderPrimaryLogo()}
                </div>
              </div>
              <div className="absolute inset-y-0 right-0 flex items-center space-x-4 pr-2 sm:static sm:inset-auto sm:ml-6 sm:pr-0">
                {renderToolbarTrailing("onBrand")}
              </div>
            </div>
          </div>

          {hasBanner ? (
            <div className={bannerShiftClass}>
              <div className="relative h-[20vh] sm:h-auto sm:max-h-80">
                <DataroomBannerMedia
                  src={fullBleedBannerSrc}
                  alt="Banner"
                  className="h-full w-full object-cover sm:max-h-80 sm:object-contain xl:object-cover"
                />
                <div className="absolute bottom-5 w-fit rounded-r-md bg-white/30 backdrop-blur-md">
                  <div className="px-5 py-2 sm:px-10">
                    <div className="text-3xl">{dataroom.name}</div>
                    {dataroom.showLastUpdated ? (
                      <time
                        className="mt-0.5 block text-sm"
                        dateTime={new Date(
                          dataroom.lastUpdatedAt,
                        ).toISOString()}
                      >
                        {t("shell.lastUpdated", "Last updated {{date}}", {
                          date: formatDateLocalized(
                            dataroom.lastUpdatedAt,
                            activeLocale,
                          ),
                        })}
                      </time>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      {linkId && viewId && viewerEmail && (
        <ViewerDownloadProgressModal
          isOpen={showDownloadModal}
          onClose={() => {
            setShowDownloadModal(false);
            setDownloadModalJobId(null);
            setDownloadFolderId(null);
            setDownloadFolderName(null);
          }}
          linkId={linkId}
          viewId={viewId}
          viewerEmail={viewerEmail}
          dataroomName={dataroom?.name ?? ""}
          dataroomId={dataroomId}
          downloadsPageUrl={downloadsPageUrl}
          initialJobId={downloadModalJobId ?? undefined}
          folderId={downloadFolderId}
          folderName={downloadFolderName}
        />
      )}
      {conversationsEnabled ? (
        <ConversationSidebar
          dataroomId={dataroomId}
          dataroomName={dataroom?.name}
          viewId={viewId || ""}
          viewerId={viewerId}
          linkId={linkId!}
          isEnabled={true}
          isOpen={showConversations}
          onOpenChange={setShowConversations}
        />
      ) : null}
      {requestListEnabled && dataroomId && linkId ? (
        <RequestListSheet
          linkId={linkId}
          dataroomId={dataroomId}
          viewId={viewId || ""}
          viewerId={viewerId}
          isOpen={showRequestList}
          onOpenChange={setShowRequestList}
        />
      ) : null}
    </nav>
  );
}
