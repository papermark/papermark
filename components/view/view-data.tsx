import dynamic from "next/dynamic";

import { useMemo } from "react";

import { ViewerChatPanel } from "@/ee/features/ai/components/viewer-chat-panel";
import {
  ViewerChatLayout,
  ViewerChatProvider,
} from "@/ee/features/ai/components/viewer-chat-provider";
import { ViewerChatToggle } from "@/ee/features/ai/components/viewer-chat-toggle";
import {
  Brand,
  DataroomBrand,
  Document,
  DocumentVersion,
} from "@prisma/client";
import { ExtendedRecordMap } from "notion-types";

import { useLazyPages } from "@/lib/hooks/use-lazy-pages";
import {
  LinkWithDataroomDocument,
  LinkWithDocument,
  NotionTheme,
  WatermarkConfig,
} from "@/lib/types";
import { useMediaQuery } from "@/lib/utils/use-media-query";

import { DEFAULT_DOCUMENT_VIEW_TYPE } from "@/components/view/document-view";
import { NotionPage } from "@/components/view/viewer/notion-page";
import PDFViewer from "@/components/view/viewer/pdf-default-viewer";

import { DEFAULT_DATAROOM_DOCUMENT_VIEW_TYPE } from "./dataroom/dataroom-document-view";
import LinkPreview from "./link-preview";
import { TNavData } from "./nav";
import AdvancedExcelViewer from "./viewer/advanced-excel-viewer";
import DownloadOnlyViewer from "./viewer/download-only-viewer";
import ImageViewer from "./viewer/image-viewer";
import PagesHorizontalViewer from "./viewer/pages-horizontal-viewer";
import PagesVerticalViewer from "./viewer/pages-vertical-viewer";
import VideoViewer from "./viewer/video-viewer";

const ExcelViewer = dynamic(
  () => import("@/components/view/viewer/excel-viewer"),
  { ssr: false },
);

export type TViewDocumentData = Document & {
  versions: DocumentVersion[];
};

const EMPTY_PAGES: never[] = [];

const isDownloadAllowed = (
  canDownload: boolean | undefined,
  linkAllowDownload: boolean | undefined,
): boolean => {
  if (canDownload === false) return false;
  return !!linkAllowDownload;
};

export default function ViewData({
  viewData,
  link,
  document,
  notionData,
  brand,
  showPoweredByBanner,
  showAccountCreationSlide,
  useAdvancedExcelViewer,
  viewerEmail,
  dataroomId,
  canDownload,
  annotationsEnabled,
  textSelectionEnabled,
  previewToken,
}: {
  viewData: DEFAULT_DOCUMENT_VIEW_TYPE | DEFAULT_DATAROOM_DOCUMENT_VIEW_TYPE;
  link: LinkWithDocument | LinkWithDataroomDocument;
  document: TViewDocumentData;
  notionData?: {
    rootNotionPageId: string | null;
    recordMap: ExtendedRecordMap | null;
    theme: NotionTheme | null;
  };
  brand?: Partial<Brand> | Partial<DataroomBrand> | null;
  showPoweredByBanner?: boolean;
  showAccountCreationSlide?: boolean;
  useAdvancedExcelViewer?: boolean;
  viewerEmail?: string;
  dataroomId?: string;
  canDownload?: boolean;
  annotationsEnabled?: boolean;
  textSelectionEnabled?: boolean;
  previewToken?: string;
}) {
  const { isMobile } = useMediaQuery();

  const documentVersionId = document.versions[0]?.id;

  const { pages: lazyPages, ensurePagesLoaded } = useLazyPages({
    initialPages: viewData.pages ?? EMPTY_PAGES,
    viewId: viewData.viewId,
    previewToken: viewData.isPreview ? previewToken : undefined,
    linkId: viewData.isPreview ? link.id : undefined,
    documentVersionId: documentVersionId,
  });

  const viewerId = "viewerId" in viewData ? viewData.viewerId : undefined;
  const conversationsEnabled =
    !!dataroomId &&
    ("conversationsEnabled" in viewData
      ? viewData.conversationsEnabled
      : false);
  const allowDownload =
    document.downloadOnly ||
    isDownloadAllowed(canDownload, link.allowDownload ?? false);

  const navData: TNavData = useMemo(
    () => ({
      viewId: viewData.viewId,
      isPreview: viewData.isPreview,
      linkId: link.id,
      brand: brand,
      viewerId,
      isMobile: isMobile,
      isDataroom: !!dataroomId,
      documentId: document.id,
      dataroomId: dataroomId,
      conversationsEnabled,
      allowDownload,
      isTeamMember: viewData.isTeamMember,
      annotationsFeatureEnabled: annotationsEnabled,
    }),
    [
      viewData.viewId,
      viewData.isPreview,
      viewData.isTeamMember,
      link.id,
      brand,
      viewerId,
      isMobile,
      dataroomId,
      document.id,
      conversationsEnabled,
      allowDownload,
      annotationsEnabled,
    ],
  );

  // Check if agents are enabled (returned from views API after access is granted)
  const agentsEnabled =
    "agentsEnabled" in viewData ? viewData.agentsEnabled : false;

  // Determine dataroom name if applicable
  const dataroomName =
    dataroomId && "dataroomName" in viewData
      ? viewData.dataroomName
      : undefined;

  return (
    <ViewerChatProvider
      enabled={agentsEnabled}
      documentId={document.id}
      documentName={document.name}
      dataroomId={dataroomId}
      dataroomName={dataroomName}
      linkId={link.id}
      viewId={viewData.viewId}
      viewerId={"viewerId" in viewData ? viewData.viewerId : undefined}
    >
      <ViewerChatLayout>
        {notionData?.recordMap ? (
          <NotionPage
            recordMap={notionData.recordMap}
            versionNumber={document.versions[0].versionNumber}
            theme={notionData.theme}
            screenshotProtectionEnabled={link.enableScreenshotProtection!}
            textSelectionEnabled={textSelectionEnabled ?? false}
            navData={navData}
          />
        ) : viewData.fileType === "link" ? (
          <LinkPreview
            linkUrl={viewData.file || document.versions[0]?.file || ""}
            linkName={document.name}
            versionNumber={document.versions[0]?.versionNumber || 1}
            navData={navData}
          />
        ) : document.downloadOnly ? (
          <DownloadOnlyViewer
            versionNumber={document.versions[0].versionNumber}
            documentName={document.name}
            navData={navData}
          />
        ) : viewData.fileType === "sheet" && viewData.sheetData ? (
          <ExcelViewer
            versionNumber={document.versions[0].versionNumber}
            sheetData={viewData.sheetData}
            screenshotProtectionEnabled={link.enableScreenshotProtection!}
            navData={navData}
          />
        ) : viewData.fileType === "sheet" && useAdvancedExcelViewer ? (
          <AdvancedExcelViewer
            file={viewData.file!}
            versionNumber={document.versions[0].versionNumber}
            navData={navData}
          />
        ) : viewData.fileType === "image" ? (
          <ImageViewer
            file={viewData.file!}
            screenshotProtectionEnabled={link.enableScreenshotProtection!}
            versionNumber={document.versions[0].versionNumber}
            showPoweredByBanner={showPoweredByBanner}
            viewerEmail={viewerEmail}
            watermarkConfig={
              link.enableWatermark
                ? (link.watermarkConfig as WatermarkConfig)
                : null
            }
            ipAddress={viewData.ipAddress}
            linkName={link.name ?? `Link #${link.id.slice(-5)}`}
            navData={navData}
          />
        ) : viewData.pages && !document.versions[0].isVertical ? (
          <PagesHorizontalViewer
            pages={lazyPages}
            feedbackEnabled={link.enableFeedback!}
            screenshotProtectionEnabled={link.enableScreenshotProtection!}
            versionNumber={document.versions[0].versionNumber}
            showPoweredByBanner={showPoweredByBanner}
            showAccountCreationSlide={showAccountCreationSlide}
            enableQuestion={link.enableQuestion}
            feedback={link.feedback}
            viewerEmail={viewerEmail}
            watermarkConfig={
              link.enableWatermark
                ? (link.watermarkConfig as WatermarkConfig)
                : null
            }
            ipAddress={viewData.ipAddress}
            linkName={link.name ?? `Link #${link.id.slice(-5)}`}
            navData={navData}
            ensurePagesLoaded={ensurePagesLoaded}
          />
        ) : viewData.pages && document.versions[0].isVertical ? (
          <PagesVerticalViewer
            pages={lazyPages}
            feedbackEnabled={link.enableFeedback!}
            screenshotProtectionEnabled={link.enableScreenshotProtection!}
            versionNumber={document.versions[0].versionNumber}
            showPoweredByBanner={showPoweredByBanner}
            enableQuestion={link.enableQuestion}
            feedback={link.feedback}
            viewerEmail={viewerEmail}
            watermarkConfig={
              link.enableWatermark
                ? (link.watermarkConfig as WatermarkConfig)
                : null
            }
            ipAddress={viewData.ipAddress}
            linkName={link.name ?? `Link #${link.id.slice(-5)}`}
            navData={navData}
            ensurePagesLoaded={ensurePagesLoaded}
          />
        ) : viewData.fileType === "video" ? (
          <VideoViewer
            file={viewData.file!}
            screenshotProtectionEnabled={link.enableScreenshotProtection!}
            versionNumber={document.versions[0].versionNumber}
            navData={navData}
          />
        ) : (
          <PDFViewer
            file={viewData.file}
            name={document.name}
            versionNumber={document.versions[0].versionNumber}
            navData={navData}
          />
        )}
      </ViewerChatLayout>

      {/* AI Chat Components */}
      <ViewerChatPanel />
      <ViewerChatToggle />
    </ViewerChatProvider>
  );
}
