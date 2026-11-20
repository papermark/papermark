import { type CSSProperties, type ReactNode, useMemo, useState } from "react";

import {
  type DataroomCardLayout,
  type DataroomViewerHeaderStyle,
} from "@/ee/features/branding/lib/dataroom-viewer-layout";
import { useBrandingPreviewParams } from "@/ee/features/branding/lib/use-branding-preview-params";
import { resolveBrandLogo } from "@/ee/features/branding/lib/brand-logo";

import { PlayIcon } from "lucide-react";

import {
  buildViewerI18nPageProps,
  type ViewerI18nPageProps,
} from "@/lib/i18n/viewer-page-props";

import { ViewerI18nProvider } from "@/components/view/viewer-i18n-provider";
import { ViewFolderTree } from "@/components/datarooms/folders";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";
import { determineTextColor } from "@/lib/utils/determine-text-color";
import { useLogoTone } from "@/ee/features/branding/lib/use-logo-tone";
import { classifyDataroomBanner } from "@/ee/features/branding/lib/dataroom-banner";
import { getDataroomPreviewDataset } from "@/ee/features/branding/lib/dataroom-preview-presets";
import DocumentCard from "@/components/view/dataroom/document-card";
import { CompactDataroomListHeader } from "@/components/view/dataroom/compact-dataroom-list-header";
import FolderCard from "@/components/view/dataroom/folder-card";
import {
  ViewerSurfaceThemeProvider,
  createViewerSurfaceTheme,
} from "@/components/view/viewer/viewer-surface-theme";

const DEFAULT_BANNER_IMAGE = "/_static/papermark-banner.png";

const DATAROOM_NAV_PAGE_FRAME =
  "mx-auto w-full px-3 md:px-6 lg:px-8 xl:px-14";

/**
 * Preview iframe mirror of `NotionLogoChip` in `nav-dataroom`: picks white or
 * black behind the cover logo based on the logo's averaged pixel luminance so
 * the chip always contrasts with the logo regardless of brand colors.
 */
function PreviewNotionLogoChip({
  src,
  shouldApplyAccent,
  surfacePanelBorderColor,
}: {
  src: string;
  shouldApplyAccent: boolean;
  surfacePanelBorderColor: string;
}) {
  const { tone, imgProps } = useLogoTone(src);
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
        shouldApplyAccent
          ? { borderColor: surfacePanelBorderColor }
          : undefined
      }
    >
      {/* Display <img> doubles as the source for `useLogoTone`'s canvas
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

/**
 * Renders the dataroom banner in the preview iframe.
 *
 * Strategy:
 *  - image  → render <img>.
 *  - YouTube→ use the official video thumbnail as a still and overlay a play
 *             badge so users see exactly what their banner will look like
 *             (we avoid the iframe because it doesn't scale well at 50%).
 *  - video  → render <video preload="metadata" muted playsInline> (no
 *             autoplay). The browser shows the first frame as the poster, and
 *             a play badge is overlaid so the user can preview frame + intent.
 */
function PreviewBannerMedia({
  src,
  className,
  imgClassName,
}: {
  src: string;
  className?: string;
  imgClassName?: string;
}) {
  const classified = classifyDataroomBanner(src);

  if (classified.kind === "youtube" && classified.youtubeId) {
    const thumb = `https://img.youtube.com/vi/${classified.youtubeId}/hqdefault.jpg`;
    return (
      <VideoBannerPreview
        className={className}
        ariaLabel="YouTube banner preview"
      >
        <img
          className={cn(
            "absolute inset-0 h-full w-full object-cover",
            imgClassName,
          )}
          src={thumb}
          alt=""
          loading="lazy"
        />
      </VideoBannerPreview>
    );
  }

  if (classified.kind === "video" && classified.src) {
    return (
      <VideoBannerPreview
        className={className}
        ariaLabel="Video banner preview"
      >
        <video
          className={cn(
            "absolute inset-0 h-full w-full object-cover",
            imgClassName,
          )}
          src={classified.src}
          preload="metadata"
          muted
          playsInline
          // first frame as poster; do not autoplay in editor preview
        />
      </VideoBannerPreview>
    );
  }

  return (
    <img
      className={cn("h-full w-full object-cover", imgClassName, className)}
      src={src}
      alt="Banner"
    />
  );
}

/** Shared layout for video / YouTube banner previews: still frame underneath
 *  + soft gradient + centered play badge so it reads as playable media. */
function VideoBannerPreview({
  children,
  className,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden bg-neutral-900",
        className,
      )}
      aria-label={ariaLabel}
    >
      {children}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-black/15" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 shadow-[0_8px_30px_rgba(0,0,0,0.35)] ring-1 ring-black/5 transition-transform duration-200 hover:scale-105">
          <PlayIcon className="ml-0.5 h-6 w-6 fill-neutral-900 text-neutral-900" />
        </div>
      </div>
    </div>
  );
}

/** Preview iframe: align with dataroom viewer (sharp corners, optional folder tree). */
export default function ViewPage({ i18n }: ViewerI18nPageProps) {
  // Seeded from the URL on first paint, then live-updated over postMessage so
  // the editor never has to reload (and therefore never flashes) this iframe.
  const {
    brandLogo,
    hideLogo,
    brandColor,
    brandBanner,
    accentColor,
    applyAccentColorToDataroomView,
    cardLayout: cardLayoutParam,
    showFolderTree: showFolderTreeParam,
    ctaLabel,
    ctaUrl,
    accentButtonColor,
    viewerHeaderStyle: viewerHeaderStyleParam,
    hideFolderIconsInMain: hideFolderIconsMainParam,
  } = useBrandingPreviewParams();
  const resolvedBrandLogo = resolveBrandLogo({
    logo: brandLogo || null,
    hideLogo: hideLogo === "1",
  });
  const [previewFolderId, setPreviewFolderId] = useState<string | null>(null);

  // Always the same "Example Virtual Data Room" — keeps the preview consistent
  // across pages and avoids depending on per-team onboarding answers.
  const previewDataset = useMemo(() => getDataroomPreviewDataset(), []);
  const previewFolders = previewDataset.folders;
  const previewDocuments = previewDataset.documents;

  // Preview docs only carry `folderName`; derive a stable folderId so the
  // tree and the main pane can filter the same way the live viewer does
  // (folders by parentId, documents by folderId).
  const folderIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const folder of previewFolders) map.set(folder.name, folder.id);
    return map;
  }, [previewFolders]);

  const getDocumentFolderId = (folderName: string | null): string | null =>
    folderName ? (folderIdByName.get(folderName) ?? null) : null;

  const filteredPreviewFolders = useMemo(
    () => previewFolders.filter((f) => f.parentId === previewFolderId),
    [previewFolders, previewFolderId],
  );

  const filteredPreviewDocuments = useMemo(
    () =>
      previewDocuments.filter(
        (doc) => getDocumentFolderId(doc.folderName) === previewFolderId,
      ),
    // getDocumentFolderId only depends on folderIdByName
    [previewDocuments, previewFolderId, folderIdByName],
  );

  const cardLayout: DataroomCardLayout =
    cardLayoutParam === "GRID" || cardLayoutParam === "COMPACT"
      ? cardLayoutParam
      : "LIST";
  const showFolderTree = showFolderTreeParam !== "0";
  const showNavCta = !!ctaLabel && !!ctaUrl;
  const showLeftColumnDesktop = showFolderTree;

  const viewerHeaderStyle: DataroomViewerHeaderStyle =
    viewerHeaderStyleParam === "SPLIT" || viewerHeaderStyleParam === "NOTION"
      ? viewerHeaderStyleParam
      : "DEFAULT";
  const hideFolderIconsInMain = hideFolderIconsMainParam === "1";
  const hasBanner = brandBanner !== "no-banner";
  const headerMode: "DEFAULT" | "SPLIT" | "NOTION" =
    hasBanner && (viewerHeaderStyle === "SPLIT" || viewerHeaderStyle === "NOTION")
      ? viewerHeaderStyle
      : "DEFAULT";
  const bannerSrc = brandBanner || DEFAULT_BANNER_IMAGE;

  // Mirror live viewer: only Modern's boxed banner shows playable video /
  // YouTube. For Default + Notion full-width banners we fall back to the
  // default banner image so the preview matches what visitors will see.
  const bannerKindPreview = classifyDataroomBanner(bannerSrc).kind;
  const fullBleedBannerSrc =
    bannerKindPreview === "video" || bannerKindPreview === "youtube"
      ? DEFAULT_BANNER_IMAGE
      : bannerSrc;

  const isModernPreview = headerMode === "SPLIT";

  const shouldApplyAccentToDataroomView =
    applyAccentColorToDataroomView === "1";
  const dataroomViewBackgroundColor = shouldApplyAccentToDataroomView
    ? accentColor
    : "#ffffff";
  const previewSurfaceTheme = createViewerSurfaceTheme(
    dataroomViewBackgroundColor,
  );
  // Adaptive CSS vars used by breadcrumb/search/separator inside Modern (SPLIT)
  // header so they match the body palette when accent is applied.
  const previewSplitSurfaceVars = {
    "--viewer-text": previewSurfaceTheme.palette.textColor,
    "--viewer-muted-text": previewSurfaceTheme.palette.mutedTextColor,
    "--viewer-subtle-text": previewSurfaceTheme.palette.subtleTextColor,
    "--viewer-panel-bg": previewSurfaceTheme.palette.panelBgColor,
    "--viewer-panel-bg-hover": previewSurfaceTheme.palette.panelHoverBgColor,
    "--viewer-panel-border": previewSurfaceTheme.palette.panelBorderColor,
    "--viewer-panel-border-hover":
      previewSurfaceTheme.palette.panelBorderHoverColor,
    "--viewer-control-bg": previewSurfaceTheme.palette.controlBgColor,
    "--viewer-control-border": previewSurfaceTheme.palette.controlBorderColor,
    "--viewer-control-border-strong":
      previewSurfaceTheme.palette.controlBorderStrongColor,
    "--viewer-control-icon": previewSurfaceTheme.palette.controlIconColor,
    "--viewer-placeholder":
      previewSurfaceTheme.palette.controlPlaceholderColor,
    "--viewer-accent":
      accentButtonColor || brandColor || previewSurfaceTheme.palette.textColor,
  } as CSSProperties;

  const itemListClassName =
    cardLayout === "GRID"
      ? null
      : cardLayout === "COMPACT"
        ? "overflow-auto"
        : "space-y-4";

  const compactPreviewShowUpdated = cardLayout === "COMPACT";
  const compactPreviewShowActions = false;

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
          <div
            className={cn(
              "text-2xl font-bold tracking-tighter",
              forLightBackground
                ? "text-neutral-900 dark:text-white"
                : "text-white",
            )}
          >
            Papermark
          </div>
        );
      case "none":
        return null;
      default: {
        const _exhaustive: never = resolvedBrandLogo;
        return _exhaustive;
      }
    }
  };

  // Without a chip the negative top margin would pull the dataroom name up
  // over the cover image, so the "none" case drops the overlap entirely.
  const notionLogo = (() => {
    const overlapping = {
      containerClassName:
        "-mt-10 relative z-10 flex w-full flex-col items-start text-left sm:-mt-12",
      titleClassName: "mt-4 max-w-3xl text-3xl",
    };
    switch (resolvedBrandLogo.kind) {
      case "custom":
        return {
          ...overlapping,
          // Notion cover logo chip: adaptive background based on the logo's
          // averaged luminance — dark logos sit in a white box, light/white
          // logos sit in a black box so they're always visible regardless of
          // brand colors.
          chip: (
            <PreviewNotionLogoChip
              src={resolvedBrandLogo.src}
              shouldApplyAccent={shouldApplyAccentToDataroomView}
              surfacePanelBorderColor={
                previewSurfaceTheme.palette.panelBorderColor
              }
            />
          ),
        };
      case "papermark":
        return {
          ...overlapping,
          chip: (
            <div
              className={cn(
                "flex size-16 items-center justify-center rounded-xl border text-sm font-semibold sm:size-20",
                shouldApplyAccentToDataroomView
                  ? ""
                  : "border-neutral-200 bg-neutral-900 text-white dark:border-neutral-700 dark:bg-white dark:text-neutral-950",
              )}
              style={
                shouldApplyAccentToDataroomView
                  ? {
                      backgroundColor: previewSurfaceTheme.palette.ctaBgColor,
                      color: previewSurfaceTheme.palette.ctaTextColor,
                      borderColor: previewSurfaceTheme.palette.panelBorderColor,
                    }
                  : undefined
              }
            >
              EX
            </div>
          ),
        };
      case "none":
        return {
          chip: null,
          containerClassName:
            "relative z-10 flex w-full flex-col items-start text-left",
          titleClassName: "max-w-3xl text-3xl",
        };
      default: {
        const _exhaustive: never = resolvedBrandLogo;
        return _exhaustive;
      }
    }
  })();

  return (
    // The cards below call `useTranslation` — without an initialized i18n
    // instance they'd render the raw `Updated {{when}}` template on the client
    // while the server interpolates it, tripping a hydration mismatch. Wrapping
    // the tree in the same provider the live viewer uses keeps both sides in
    // lockstep.
    <ViewerI18nProvider locale={i18n.locale} resources={i18n.resources}>
      <div
        className="min-h-screen bg-white"
        style={
          {
            backgroundColor: dataroomViewBackgroundColor,
          } as CSSProperties
        }
      >
        {/* Header — matches live viewer modes */}
      <nav
        className={cn(
          headerMode === "SPLIT"
            ? cn(
                "border-b border-[var(--viewer-panel-border)] text-neutral-900 dark:text-neutral-100",
                shouldApplyAccentToDataroomView
                  ? ""
                  : "bg-white dark:bg-neutral-950",
              )
            : "bg-black",
        )}
        style={
          headerMode === "SPLIT"
            ? {
                ...previewSplitSurfaceVars,
                ...(shouldApplyAccentToDataroomView
                  ? { backgroundColor: dataroomViewBackgroundColor }
                  : {}),
              }
            : { backgroundColor: brandColor || "#000000" }
        }
      >
        {headerMode === "NOTION" && hasBanner ? (
          <>
            {/* Notion preset: no brand-colored navbar above the cover image.
                In the real viewer the CTA/conversations/download buttons get
                relocated into the body toolbar (right of the search input). */}
            <div className="relative h-[20vh] w-full overflow-hidden bg-neutral-100 dark:bg-neutral-900 sm:h-auto sm:max-h-80">
              <PreviewBannerMedia
                src={fullBleedBannerSrc}
                className="h-full w-full"
                imgClassName="h-full w-full object-cover sm:max-h-80 sm:object-contain xl:object-cover"
              />
            </div>
            <div
              className={cn(
                "text-black dark:text-white",
                shouldApplyAccentToDataroomView
                  ? ""
                  : "bg-white dark:bg-neutral-950",
              )}
              style={
                shouldApplyAccentToDataroomView
                  ? {
                      ...previewSplitSurfaceVars,
                      backgroundColor: dataroomViewBackgroundColor,
                    }
                  : previewSplitSurfaceVars
              }
            >
              <div className={cn(DATAROOM_NAV_PAGE_FRAME, "pb-10 pt-2")}>
                <div className={notionLogo.containerClassName}>
                  {notionLogo.chip}
                  <div
                    className={notionLogo.titleClassName}
                    style={
                      shouldApplyAccentToDataroomView
                        ? { color: previewSurfaceTheme.palette.textColor }
                        : undefined
                    }
                  >
                    Example Data Room
                  </div>
                  <time
                    className="mt-0.5 block text-sm text-neutral-600 dark:text-neutral-400"
                    style={
                      shouldApplyAccentToDataroomView
                        ? { color: previewSurfaceTheme.palette.mutedTextColor }
                        : undefined
                    }
                  >
                    Last updated 2 hours ago
                  </time>
                </div>
              </div>
            </div>
          </>
        ) : headerMode === "SPLIT" && hasBanner ? (
          <>
            <div className={cn(DATAROOM_NAV_PAGE_FRAME, "pt-4")}>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--viewer-panel-border)] pb-2">
                <div className="relative flex min-h-14 shrink-0 items-center">
                  {renderPrimaryLogo(true)}
                </div>
                <div className="flex min-w-0 shrink items-center justify-end gap-2">
                  {showNavCta ? (
                    <a
                      href={ctaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center justify-center rounded-md px-4 py-2 text-sm font-medium"
                      style={{
                        backgroundColor:
                          accentButtonColor || brandColor || "#111827",
                        color: determineTextColor(
                          accentButtonColor || brandColor || "#111827",
                        ),
                      }}
                    >
                      {ctaLabel}
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,40%)] lg:items-center lg:gap-8 lg:py-6">
                <div className="min-w-0 space-y-2">
                  <p
                    className="text-[11px] font-medium uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400"
                    style={
                      shouldApplyAccentToDataroomView
                        ? { color: previewSurfaceTheme.palette.mutedTextColor }
                        : undefined
                    }
                  >
                    DATA ROOM · UPDATED MAY 10, 2026
                  </p>
                  <h1
                    className="text-balance text-3xl text-neutral-950 dark:text-white"
                    style={
                      shouldApplyAccentToDataroomView
                        ? { color: previewSurfaceTheme.palette.textColor }
                        : undefined
                    }
                  >
                    Example Data Room
                  </h1>
                  <p
                    className="max-w-2xl text-pretty text-sm leading-relaxed text-neutral-600 dark:text-neutral-300"
                    style={
                      shouldApplyAccentToDataroomView
                        ? { color: previewSurfaceTheme.palette.mutedTextColor }
                        : undefined
                    }
                  >
                    Preview of the modern layout: hero copy uses your welcome
                    message when set in branding.
                  </p>
                </div>
                <div className="relative aspect-[16/7] w-full overflow-hidden rounded-xl border border-neutral-200/90 bg-neutral-200/30 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 lg:aspect-[16/9]">
                  <div className="absolute inset-0">
                    <PreviewBannerMedia src={bannerSrc} />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1 overflow-hidden">
                  {previewFolders.length > 0 ? (
                    <Breadcrumb>
                      <BreadcrumbList className="text-sm text-[var(--viewer-muted-text)]">
                        <BreadcrumbItem>
                          <BreadcrumbLink
                            onClick={() => setPreviewFolderId(null)}
                            className="cursor-pointer text-[var(--viewer-muted-text)] hover:text-[var(--viewer-text)]"
                          >
                            Home
                          </BreadcrumbLink>
                        </BreadcrumbItem>
                        {previewFolderId ? (
                          <>
                            <BreadcrumbSeparator className="text-[var(--viewer-subtle-text)]" />
                            <BreadcrumbItem>
                              <BreadcrumbPage className="font-medium text-[var(--viewer-text)]">
                                {previewFolders.find(
                                  (f) => f.id === previewFolderId,
                                )?.name ?? "Folder"}
                              </BreadcrumbPage>
                            </BreadcrumbItem>
                          </>
                        ) : null}
                      </BreadcrumbList>
                    </Breadcrumb>
                  ) : (
                    <div className="text-sm text-[var(--viewer-muted-text)]">
                      Home
                    </div>
                  )}
                </div>
                {/* Right cluster mirrors the live viewer: search input + action
                    button placeholders (Generate Index, Add Document) live on
                    the same line as the search so Modern's nav top-row matches
                    Standard's body toolbar. */}
                <div className="flex min-w-0 shrink-0 items-center gap-x-2">
                  <div
                    className="h-9 w-full min-w-[12rem] max-w-sm shrink-0 rounded-md border border-[var(--viewer-control-border)] bg-[var(--viewer-control-bg)] shadow-sm sm:w-72"
                    aria-hidden
                  />
                  <div
                    className="h-9 w-28 shrink-0 rounded-md border border-[var(--viewer-control-border)] bg-[var(--viewer-control-bg)] shadow-sm"
                    aria-hidden
                    title="Generate index"
                  />
                  <div
                    className="h-9 w-28 shrink-0 rounded-md border border-[var(--viewer-control-border)] bg-[var(--viewer-control-bg)] shadow-sm"
                    aria-hidden
                    title="Add document"
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className={DATAROOM_NAV_PAGE_FRAME}>
              <div className="relative flex h-16 items-center justify-between">
                <div className="flex flex-1 items-center justify-start">
                  <div className="relative flex h-16 w-36 flex-shrink-0 items-center overflow-y-hidden">
                    {renderPrimaryLogo()}
                  </div>
                </div>
                {showNavCta && (
                  <a
                    href={ctaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium"
                    style={{
                      backgroundColor:
                        accentButtonColor || brandColor || "#ffffff",
                      color: determineTextColor(
                        accentButtonColor || brandColor || "#ffffff",
                      ),
                    }}
                  >
                    {ctaLabel}
                  </a>
                )}
              </div>
            </div>

            {hasBanner ? (
              <div className="relative h-[20vh] sm:h-auto sm:max-h-80">
                <PreviewBannerMedia
                  src={fullBleedBannerSrc}
                  imgClassName="sm:max-h-80 sm:object-contain xl:object-cover"
                />
                <div className="absolute bottom-5 w-fit rounded-r-md bg-white/30 backdrop-blur-md">
                  <div className="px-5 py-2 sm:px-10">
                    <div className="text-3xl">Example Data Room</div>
                    <time className="mt-0.5 block text-sm">
                      Last updated 2 hours ago
                    </time>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </nav>

      {/* Body */}
      <ViewerSurfaceThemeProvider value={previewSurfaceTheme}>
        <div
          style={
            {
              minHeight: "min(560px, 70vh)",
            } as CSSProperties
          }
          className="relative flex flex-1"
        >
          {showLeftColumnDesktop && (
            <div
              className="hidden h-full shrink-0 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-4 md:block md:px-4 md:pt-6 lg:px-6 lg:pt-9 xl:px-8"
              style={{ width: "clamp(260px, 28vw, 440px)" }}
            >
              {brandBanner === "no-banner" && (
                <div className="mb-3 min-w-0">
                  <div
                    className="text-3xl"
                    style={{ color: previewSurfaceTheme.palette.textColor }}
                  >
                    Example Data Room
                  </div>
                  <time
                    className="mt-0.5 block text-sm"
                    style={{
                      color: previewSurfaceTheme.palette.mutedTextColor,
                    }}
                  >
                    Last updated 2 hours ago
                  </time>
                </div>
              )}
              {showFolderTree && (
                <ViewFolderTree
                  folders={previewFolders}
                  documents={previewDocuments.map((doc) => ({
                    id: doc.id,
                    name: doc.name,
                    dataroomDocumentId: doc.dataroomDocumentId,
                    folderId: getDocumentFolderId(doc.folderName),
                    orderIndex: null,
                    hierarchicalIndex: null,
                    versions: doc.versions.map((v) => ({
                      id: v.id,
                      versionNumber: v.versionNumber,
                      hasPages: v.hasPages,
                    })),
                  }))}
                  setFolderId={setPreviewFolderId}
                  folderId={previewFolderId}
                />
              )}
            </div>
          )}

          {/* Detail view */}
          <div className="flex-grow overflow-auto">
            <div className="h-full space-y-8 px-3 pb-4 pt-4 md:px-6 md:pt-6 lg:px-8 lg:pt-9 xl:px-14">
              <div className="space-y-4">
                {brandBanner === "no-banner" && !showLeftColumnDesktop ? (
                  <div className="-mb-2 min-w-0 md:-mb-1">
                    <div
                      className="text-3xl"
                      style={{ color: previewSurfaceTheme.palette.textColor }}
                    >
                      Example Data Room
                    </div>
                    <div
                      className="mt-0.5 block text-sm"
                      style={{
                        color: previewSurfaceTheme.palette.mutedTextColor,
                      }}
                    >
                      Last updated 2 hours ago
                    </div>
                  </div>
                ) : null}
                {cardLayout === "LIST" && !isModernPreview ? (
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-x-2 gap-y-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                      {!showFolderTree && previewFolders.length > 0 ? (
                        <Breadcrumb>
                          <BreadcrumbList className="text-sm text-neutral-600 dark:text-neutral-400">
                            <BreadcrumbItem>
                              <BreadcrumbLink
                                onClick={() => setPreviewFolderId(null)}
                                className="cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-100"
                              >
                                Home
                              </BreadcrumbLink>
                            </BreadcrumbItem>
                            {previewFolderId ? (
                              <>
                                <BreadcrumbSeparator className="text-neutral-400" />
                                <BreadcrumbItem>
                                  <BreadcrumbPage className="font-medium text-neutral-900 dark:text-neutral-100">
                                    {previewFolders.find(
                                      (f) => f.id === previewFolderId,
                                    )?.name ?? "Folder"}
                                  </BreadcrumbPage>
                                </BreadcrumbItem>
                              </>
                            ) : null}
                          </BreadcrumbList>
                        </Breadcrumb>
                      ) : (
                        <div
                          className={`text-sm ${previewSurfaceTheme.usesLightText ? "text-white/70" : "text-muted-foreground"}`}
                        >
                          Home
                        </div>
                      )}
                    </div>
                    <div
                      className="h-9 w-full min-w-[12rem] max-w-sm shrink-0 rounded-md border border-neutral-300 bg-white shadow-sm dark:border-neutral-600 dark:bg-neutral-900 sm:w-72"
                      aria-hidden
                    />
                  </div>
                ) : null}
                {cardLayout === "GRID" ? (
                  <div className="space-y-4">
                    <ul
                      role="list"
                      className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4"
                    >
                      {filteredPreviewFolders.map((folder) => (
                        <li key={folder.id}>
                          <FolderCard
                            folder={folder}
                            dataroomId="1"
                            setFolderId={setPreviewFolderId}
                            isPreview={false}
                            linkId="1"
                            allowDownload={false}
                            layout={cardLayout}
                            hideFolderIcons={hideFolderIconsInMain}
                            compactShowUpdatedColumn={compactPreviewShowUpdated}
                            compactShowActionsColumn={compactPreviewShowActions}
                          />
                        </li>
                      ))}
                    </ul>
                    <ul
                      role="list"
                      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                    >
                      {filteredPreviewDocuments.map((doc) => (
                        <li key={doc.id}>
                          <DocumentCard
                            document={{
                              id: doc.id,
                              name: doc.name,
                              dataroomDocumentId: doc.dataroomDocumentId,
                              downloadOnly: doc.downloadOnly,
                              canDownload: doc.canDownload,
                              hierarchicalIndex: doc.hierarchicalIndex,
                              versions: doc.versions,
                            }}
                            linkId="1"
                            isPreview={false}
                            allowDownload={false}
                            layout={cardLayout}
                            compactShowUpdatedColumn={compactPreviewShowUpdated}
                            compactShowActionsColumn={compactPreviewShowActions}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div
                    className={cn(
                      cardLayout === "COMPACT" &&
                        "mt-4 border-t border-[var(--viewer-panel-border)]",
                    )}
                  >
                    {cardLayout === "COMPACT" ? (
                      <CompactDataroomListHeader
                        showUpdatedColumn={compactPreviewShowUpdated}
                        showSettingsColumn={compactPreviewShowActions}
                        showIndexColumn
                      />
                    ) : null}
                    <ul className={itemListClassName ?? ""}>
                      {filteredPreviewFolders.map((folder, idx) => (
                        <li key={folder.id}>
                          <FolderCard
                            folder={folder}
                            dataroomId="1"
                            setFolderId={setPreviewFolderId}
                            isPreview={false}
                            linkId="1"
                            allowDownload={false}
                            layout={cardLayout}
                            hideFolderIcons={hideFolderIconsInMain}
                            compactShowUpdatedColumn={
                              compactPreviewShowUpdated
                            }
                            compactShowActionsColumn={
                              compactPreviewShowActions
                            }
                            compactShowIndexColumn={cardLayout === "COMPACT"}
                            editorialIndex={idx}
                          />
                        </li>
                      ))}

                      {filteredPreviewDocuments.map((doc, idx) => (
                        <li key={doc.id}>
                          <DocumentCard
                            document={{
                              id: doc.id,
                              name: doc.name,
                              dataroomDocumentId: doc.dataroomDocumentId,
                              downloadOnly: doc.downloadOnly,
                              canDownload: doc.canDownload,
                              hierarchicalIndex: doc.hierarchicalIndex,
                              versions: doc.versions,
                            }}
                            linkId="1"
                            isPreview={false}
                            allowDownload={false}
                            layout={cardLayout}
                            compactShowUpdatedColumn={
                              compactPreviewShowUpdated
                            }
                            compactShowActionsColumn={
                              compactPreviewShowActions
                            }
                            compactShowIndexColumn={cardLayout === "COMPACT"}
                            editorialIndex={
                              filteredPreviewFolders.length + idx
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </ViewerSurfaceThemeProvider>
      </div>
    </ViewerI18nProvider>
  );
}

/**
 * Load the viewer translation bundles at build time so the preview iframe
 * renders translated card copy identically on the server and the client. We
 * always use the default locale here — the branding preview isn't a live
 * visitor surface, so there's no per-brand language to resolve.
 */
export const getStaticProps = async () => {
  const props = await buildViewerI18nPageProps(null);
  return { props };
};
