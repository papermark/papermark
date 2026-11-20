import Link from "next/link";
import { useRouter } from "next/router";

import React, { useEffect, useState } from "react";

import { useViewerChatSafe } from "@/ee/features/ai/components/viewer-chat-provider";
import { resolveBrandLogo } from "@/ee/features/branding/lib/brand-logo";
import { useConversationSidebarSafe } from "@/ee/features/conversations/components/viewer/conversation-sidebar-provider";
import { Brand, DataroomBrand } from "@prisma/client";
import {
  ArrowUpRight,
  BadgeInfoIcon,
  Download,
  Maximize,
  Minimize,
  Slash,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { createAdaptiveSurfacePalette } from "@/lib/utils/create-adaptive-surface-palette";
import { determineTextColor } from "@/lib/utils/determine-text-color";
import { downloadFromLinkEndpoint } from "@/lib/utils/download-document";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import PapermarkSparkle from "../shared/icons/papermark-sparkle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../ui/breadcrumb";
import { Button } from "../ui/button";
import { AnnotationToggle } from "./annotations/annotation-toggle";
import { ConversationSidebar } from "./conversations/sidebar";
import ReportForm from "./report-form";

export type TNavData = {
  linkId: string;
  documentId: string;
  documentName?: string;
  dataroomName?: string;
  allowDownload?: boolean;
  brand?: Partial<Brand> | Partial<DataroomBrand> | null;
  isDataroom?: boolean;
  viewId?: string;
  viewerId?: string;
  isMobile?: boolean;
  isPreview?: boolean;
  dataroomId?: string;
  conversationsEnabled?: boolean;
  isTeamMember?: boolean;
  annotationsEnabled?: boolean;
  hasAnnotations?: boolean;
  annotationsFeatureEnabled?: boolean;
  onToggleAnnotations?: (enabled: boolean) => void;
};

export default function Nav({
  navData,
  type,
  pageNumber,
  numPages,
  embeddedLinks,
  hasWatermark,
  handleZoomIn,
  handleZoomOut,
  handleFullscreen,
  isFullscreen,
  hidePageCount,
}: {
  navData: TNavData;
  type?: "pdf" | "notion" | "sheet";
  pageNumber?: number;
  numPages?: number;
  embeddedLinks?: string[];
  hasWatermark?: boolean;
  handleZoomIn?: () => void;
  handleZoomOut?: () => void;
  handleFullscreen?: () => void;
  isFullscreen?: boolean;
  hidePageCount?: boolean;
}) {
  const router = useRouter();
  const asPath = router.asPath;
  const { previewToken, preview } = router.query;

  // Get chat context to adjust navbar when chat is open
  const chatContext = useViewerChatSafe();
  const isChatOpen = chatContext?.isOpen && chatContext?.isEnabled;

  // Read the Q&A sidebar's open state from the same context that drives the
  // content padding (ConversationSidebarLayout). Using this instead of the
  // local `showConversations` keeps the navbar's counter-margin in lockstep
  // with the padding — both flip in one commit — so the navbar doesn't jump
  // while the panel opens/closes.
  const conversationSidebar = useConversationSidebarSafe();
  const isConversationSidebarOpen = !!conversationSidebar?.isOpen;

  const {
    linkId,
    allowDownload,
    brand,
    isDataroom,
    viewId,
    viewerId,
    isMobile,
    isPreview,
    documentId,
    documentName,
    dataroomId,
    dataroomName,
    conversationsEnabled,
    isTeamMember,
    annotationsEnabled,
    hasAnnotations,
    annotationsFeatureEnabled,
    onToggleAnnotations,
  } = navData;

  const { t } = useTranslation("viewer");
  const [showConversations, setShowConversations] = useState(false);
  const brandColor = brand?.brandColor || "black";
  const navColorPalette = createAdaptiveSurfacePalette(brandColor);
  const resolvedBrandLogo = resolveBrandLogo(brand);
  const renderBrandLogo = () => {
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
            className="text-2xl font-bold tracking-tighter"
            style={{ color: navColorPalette.textColor }}
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

  const ctaLabel = (brand as { ctaLabel?: string | null } | null | undefined)
    ?.ctaLabel;
  const ctaUrlRaw = (brand as { ctaUrl?: string | null } | null | undefined)
    ?.ctaUrl;
  const accentButtonColor = (
    brand as { accentButtonColor?: string | null } | null | undefined
  )?.accentButtonColor;
  const safeCtaUrl = (() => {
    if (!ctaUrlRaw) return null;
    try {
      const url = new URL(ctaUrlRaw);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.toString();
    } catch {
      return null;
    }
  })();
  const showCta = !!ctaLabel && !!safeCtaUrl;

  // Extract the dataroom path from the URL
  // This regex captures everything before "/d/" in the path
  const dataroomPathMatch = asPath.match(/^(.*?)\/d\//);
  const dataroomPath = dataroomPathMatch ? dataroomPathMatch[1] : "";

  const downloadFile = async () => {
    if (isPreview) {
      toast.error(
        t(
          "toasts.cannotDownloadPreview",
          "You cannot download documents in preview mode.",
        ),
      );
      return;
    }
    if (!allowDownload || type === "notion") return;

    // The server only produces a buffered binary response (which is when this
    // fallback is consulted) for watermarked PDFs today, but other viewers
    // ("sheet", future flows) share this Nav. Derive a safe fallback from the
    // viewer `type` rather than hardcoding ".pdf" so non-PDF flows don't get
    // a misleading extension if the contract ever broadens. We don't have the
    // document name here, so we use a generic "document"-stem fallback.
    const fallbackFileName =
      !type || type === "pdf" ? "document.pdf" : "document";

    const downloadPromise = downloadFromLinkEndpoint({
      endpoint: "/api/links/download",
      body: { linkId, viewId },
      fallbackFileName,
    });

    toast.promise(downloadPromise, {
      loading: hasWatermark
        ? t(
            "toasts.preparingDownloadWatermark",
            "Preparing download with watermark...",
          )
        : t("toasts.preparingDownload", "Preparing download..."),
      success: t("toasts.downloadSuccess", "File downloaded successfully"),
      error: (err) =>
        err.message || t("toasts.downloadFailed", "Failed to download file"),
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle conversations with 'c' key
      if (
        e.key === "c" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        isDataroom &&
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
  }, [isDataroom, conversationsEnabled, showConversations]);

  return (
    <nav
      data-viewer-top-bar
      className="transition-[margin] duration-300 ease-in-out"
      style={{
        backgroundColor: brandColor,
        // The chat / Q&A panel shifts the content by padding the parent
        // (transition-all duration-300). We cancel that padding with a
        // matching-easing negative margin so the navbar stays full-width and
        // visually static instead of jumping while the transition runs.
        marginRight:
          isChatOpen || isConversationSidebarOpen ? "-400px" : undefined,
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-[80]"
        style={{
          height: "env(safe-area-inset-top, 0px)",
          backgroundColor: brandColor,
        }}
      />
      <div className="mx-auto px-2 sm:px-6 lg:px-8">
        <div className="relative flex h-16 items-center justify-between">
          <div className="flex flex-1 items-center justify-start">
            {/* Without a logo the slot must not reserve its width, or a ghost
                spacer pushes the breadcrumb off the left edge. */}
            <div
              className={cn(
                "relative flex h-16 flex-shrink-0 items-center",
                resolvedBrandLogo.kind !== "none" && "w-36",
              )}
            >
              {renderBrandLogo()}
            </div>
            {isDataroom ? (
              <Breadcrumb className="ml-6">
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink
                      className="cursor-pointer underline underline-offset-4 hover:font-medium"
                      href={`${dataroomPath}${isPreview ? "?previewToken=" + previewToken + "&preview=" + preview : ""}`}
                      style={{
                        color: navColorPalette.textColor,
                      }}
                    >
                      {t("nav.home", "Home")}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  {type === "notion" ? (
                    <>
                      <BreadcrumbSeparator>
                        <Slash />
                      </BreadcrumbSeparator>
                      <div id="view-breadcrump-portal"></div>
                    </>
                  ) : null}
                </BreadcrumbList>
              </Breadcrumb>
            ) : type === "notion" ? (
              <Breadcrumb>
                <BreadcrumbList>
                  <div id="view-breadcrump-portal"></div>
                </BreadcrumbList>
              </Breadcrumb>
            ) : null}
          </div>
          <div className="absolute inset-y-0 right-0 flex items-center space-x-2 pr-2 sm:static sm:inset-auto sm:ml-6 sm:space-x-4 sm:pr-0">
            {showCta && (
              <a
                href={safeCtaUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors hover:opacity-90 sm:h-10"
                style={{
                  backgroundColor:
                    accentButtonColor || brand?.brandColor || "#111827",
                  color: determineTextColor(
                    accentButtonColor || brand?.brandColor || "#111827",
                  ),
                }}
              >
                {ctaLabel}
              </a>
            )}
            {isTeamMember && (
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="size-8 bg-gray-900 text-white hover:bg-gray-900/80 sm:size-10"
                      size="icon"
                    >
                      <BadgeInfoIcon className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs text-wrap text-center">
                      {t(
                        "nav.teamMemberTooltip",
                        "Skipped verification because you are a team member; no analytics will be collected",
                      )}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {/* Conversation toggle button for dataroom documents */}
            {isDataroom && conversationsEnabled && (
              <Button
                onClick={() => setShowConversations(!showConversations)}
                className="bg-gray-900 text-white hover:bg-gray-900/80"
              >
                {t("nav.viewQA", "View Q&A")}
              </Button>
            )}
            {/* Annotations toggle button */}
            {onToggleAnnotations && annotationsFeatureEnabled && (
              <AnnotationToggle
                enabled={annotationsEnabled || false}
                onToggle={onToggleAnnotations}
                hasAnnotations={hasAnnotations}
              />
            )}
            {embeddedLinks && embeddedLinks.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <Button className="bg-gray-900 text-sm font-medium text-white hover:bg-gray-900/80">
                    {t("nav.linksOnPage", "Links on Page")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="space-y-2" align="end">
                  <DropdownMenuLabel>
                    {t("nav.linksOnCurrentPage", "Links on current page")}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {embeddedLinks.map((link, index) => (
                    <Link
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      key={index}
                    >
                      <DropdownMenuItem className="group h-10">
                        <span className="w-[200px] truncate group-focus:overflow-x-auto group-focus:text-clip">
                          {link}
                        </span>
                        <DropdownMenuShortcut className="pl-2 opacity-0 group-hover:opacity-60 group-focus:opacity-60">
                          <ArrowUpRight />
                        </DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </Link>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}

            {allowDownload ? (
              <Button
                onClick={downloadFile}
                className="size-8 bg-gray-900 text-white hover:bg-gray-900/80 sm:size-10"
                size="icon"
                title={t("nav.downloadDocument", "Download document")}
              >
                <Download className="size-4 sm:size-5" />
              </Button>
            ) : null}

            {/* Mobile controls: pinch is the primary zoom gesture (pinch back
                out to fit), so the top bar exposes only a fullscreen toggle.
                Keeping the bar sparse avoids overflow on narrow screens. */}
            {isMobile && handleFullscreen && (
              <Button
                onClick={handleFullscreen}
                className="size-8 bg-gray-900 text-white hover:bg-gray-900/80"
                size="icon"
                title={
                  isFullscreen
                    ? t("nav.exitFullscreen", "Exit fullscreen")
                    : t("nav.fullscreen", "Fullscreen")
                }
                aria-label={
                  isFullscreen
                    ? t("nav.exitFullscreen", "Exit fullscreen")
                    : t("nav.fullscreen", "Fullscreen")
                }
              >
                {isFullscreen ? (
                  <Minimize className="h-4 w-4" />
                ) : (
                  <Maximize className="h-4 w-4" />
                )}
              </Button>
            )}

            {!isMobile && handleZoomIn && handleZoomOut && (
              <div className="flex gap-1">
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={handleZoomIn}
                        className="bg-gray-900 text-white hover:bg-gray-900/80"
                        size="icon"
                      >
                        <ZoomInIcon className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span className="mr-2 text-xs">
                        {t("nav.zoomIn", "Zoom in")}
                      </span>
                      <span className="ml-auto rounded-sm border bg-muted p-0.5 text-xs tracking-widest text-muted-foreground">
                        ⌘+
                      </span>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={handleZoomOut}
                        className="bg-gray-900 text-white hover:bg-gray-900/80"
                        size="icon"
                      >
                        <ZoomOutIcon className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span className="mr-2 text-xs">
                        {t("nav.zoomOut", "Zoom out")}
                      </span>
                      <span className="ml-auto rounded-sm border bg-muted p-0.5 text-xs tracking-widest text-muted-foreground">
                        ⌘-
                      </span>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {handleFullscreen && (
                  <TooltipProvider delayDuration={50}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={handleFullscreen}
                          className="bg-gray-900 text-white hover:bg-gray-900/80"
                          size="icon"
                          aria-label={
                            isFullscreen
                              ? t("nav.exitFullscreen", "Exit fullscreen")
                              : t("nav.fullscreen", "Fullscreen")
                          }
                        >
                          {isFullscreen ? (
                            <Minimize className="h-5 w-5" />
                          ) : (
                            <Maximize className="h-5 w-5" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <span className="mr-2 text-xs">
                          {isFullscreen
                            ? t("nav.exitFullscreen", "Exit fullscreen")
                            : t("nav.fullscreen", "Fullscreen")}
                        </span>
                        <span className="ml-auto rounded-sm border bg-muted p-0.5 text-xs tracking-widest text-muted-foreground">
                          F
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            )}

            {!hidePageCount && pageNumber && numPages && numPages > 1 ? (
              <div className="flex h-8 items-center space-x-1 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white sm:h-10 sm:px-4 sm:py-2 sm:text-sm">
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {pageNumber}
                </span>
                <span className="text-gray-400">/</span>
                <span
                  className="text-gray-400"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {numPages}
                </span>
              </div>
            ) : null}
            {/* add a separator that doesn't use radix or shadcn  */}
            <div className="h-6 w-px bg-gray-800" />
            <ReportForm
              linkId={linkId}
              documentId={documentId}
              viewId={viewId}
            />
          </div>
        </div>
      </div>
      {isDataroom && conversationsEnabled ? (
        <ConversationSidebar
          dataroomId={dataroomId}
          documentId={documentId}
          documentName={documentName}
          dataroomName={dataroomName}
          pageNumber={pageNumber}
          viewId={viewId || ""}
          viewerId={viewerId}
          linkId={linkId!}
          isEnabled={true}
          isOpen={showConversations}
          onOpenChange={setShowConversations}
        />
      ) : null}
    </nav>
  );
}
