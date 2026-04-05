import Link from "next/link";
import { useRouter } from "next/router";

import React, { useEffect, useState } from "react";

import { useViewerChatSafe } from "@/ee/features/ai/components/viewer-chat-provider";
import { Brand, DataroomBrand } from "@prisma/client";
import {
  ArrowUpRight,
  BadgeInfoIcon,
  Download,
  Maximize,
  MessageCircle,
  Slash,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { toast } from "sonner";

import { createAdaptiveSurfacePalette } from "@/lib/utils/create-adaptive-surface-palette";

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
}) {
  const router = useRouter();
  const asPath = router.asPath;
  const { previewToken, preview } = router.query;

  // Get chat context to adjust navbar when chat is open
  const chatContext = useViewerChatSafe();
  const isChatOpen = chatContext?.isOpen && chatContext?.isEnabled;

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
    dataroomId,
    conversationsEnabled,
    isTeamMember,
    annotationsEnabled,
    hasAnnotations,
    annotationsFeatureEnabled,
    onToggleAnnotations,
  } = navData;

  const [showConversations, setShowConversations] = useState(false);
  const navColorPalette = createAdaptiveSurfacePalette(brand?.brandColor);

  // Extract the dataroom path from the URL
  // This regex captures everything before "/d/" in the path
  const dataroomPathMatch = asPath.match(/^(.*?)\/d\//);
  const dataroomPath = dataroomPathMatch ? dataroomPathMatch[1] : "";

  const downloadFile = async () => {
    if (isPreview) {
      toast.error("You cannot download documents in preview mode.");
      return;
    }
    if (!allowDownload || type === "notion") return;

    const downloadPromise = (async () => {
      const response = await fetch(`/api/links/download`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ linkId, viewId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || "Failed to download file";
        throw new Error(errorMessage);
      }

      // Check if the response is a PDF file (for watermarked PDFs)
      const contentType = response.headers.get("content-type");
      if (contentType === "application/pdf") {
        // Handle direct PDF download (watermarked PDFs)
        const pdfBlob = await response.blob();
        const blobUrl = window.URL.createObjectURL(pdfBlob);

        // Extract filename from Content-Disposition header
        const contentDisposition = response.headers.get("content-disposition");
        let filename = "document.pdf";
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(
            /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/,
          );
          if (filenameMatch && filenameMatch[1]) {
            filename = decodeURIComponent(
              filenameMatch[1].replace(/['"]/g, ""),
            );
          }
        }

        const link = document.createElement("a");
        link.href = blobUrl;
        link.rel = "noopener noreferrer";
        link.download = filename;
        document.body.appendChild(link);
        link.click();

        setTimeout(() => {
          window.URL.revokeObjectURL(blobUrl);
          document.body.removeChild(link);
        }, 100);
      } else {
        // Handle JSON response with downloadUrl (non-watermarked files)
        const { downloadUrl } = await response.json();

        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        document.body.appendChild(iframe);
        iframe.src = downloadUrl;

        setTimeout(() => {
          if (iframe.parentNode) {
            document.body.removeChild(iframe);
          }
        }, 5000);
      }

      return "File downloaded successfully";
    })();

    toast.promise(downloadPromise, {
      loading: hasWatermark
        ? "Preparing download with watermark..."
        : "Preparing download...",
      success: (message) => message,
      error: (err) => err.message || "Failed to download file",
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

  return (
    <nav
      className="bg-black"
      style={{
        backgroundColor: brand && brand.brandColor ? brand.brandColor : "black",
        // Extend navbar to full width when chat panel is open (counteract parent padding)
        marginRight: isChatOpen ? "-400px" : undefined,
        // paddingRight: isChatOpen ? "400px" : undefined,
      }}
    >
      <div className="mx-auto px-2 sm:px-6 lg:px-8">
        <div className="relative flex h-16 items-center justify-between">
          <div className="flex flex-1 items-center justify-start">
            <div className="relative flex h-16 w-36 flex-shrink-0 items-center">
              {brand && brand.logo ? (
                <img
                  className="h-16 w-36 object-contain"
                  src={brand.logo}
                  alt="Logo"
                  // fill
                  // quality={100}
                  // priority
                />
              ) : (
                <Link
                  href={`https://www.papermark.com?utm_campaign=navbar&utm_medium=navbar&utm_source=papermark-${linkId}`}
                  target="_blank"
                  className="text-2xl font-bold tracking-tighter text-white"
                >
                  Papermark
                </Link>
              )}
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
                      Home
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
            {isTeamMember && (
              <TooltipProvider delayDuration={100}>
                <Tooltip defaultOpen>
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
                      Skipped verification because you are a team member; no
                      analytics will be collected
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {/* Conversation toggle button for dataroom and document links */}
            {conversationsEnabled && (
              <Button
                onClick={() => setShowConversations(!showConversations)}
                className="bg-gray-900 text-white hover:bg-gray-900/80"
              >
                <MessageCircle className="mr-2 h-4 w-4" />
                Q&A
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
                    Links on Page
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="space-y-2" align="end">
                  <DropdownMenuLabel>Links on current page</DropdownMenuLabel>
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
                title="Download document"
              >
                <Download className="size-4 sm:size-5" />
              </Button>
            ) : null}

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
                      <span className="mr-2 text-xs">Zoom in</span>
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
                      <span className="mr-2 text-xs">Zoom out</span>
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
                        >
                          <Maximize className="h-5 w-5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <span className="mr-2 text-xs">Fullscreen</span>
                        <span className="ml-auto rounded-sm border bg-muted p-0.5 text-xs tracking-widest text-muted-foreground">
                          F
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            )}

            {pageNumber && numPages ? (
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
      {conversationsEnabled && showConversations ? (
        <ConversationSidebar
          dataroomId={dataroomId}
          documentId={documentId}
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
