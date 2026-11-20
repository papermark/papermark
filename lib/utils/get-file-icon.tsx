import { FileCode, FileIcon, Link as LinkIcon, MailIcon } from "lucide-react";

import CadIcon from "@/components/shared/icons/files/cad";
import DocsIcon from "@/components/shared/icons/files/docs";
import ImageFileIcon from "@/components/shared/icons/files/image";
import MapIcon from "@/components/shared/icons/files/map";
import NotionIcon from "@/components/shared/icons/files/notion";
import PdfIcon from "@/components/shared/icons/files/pdf";
import SheetIcon from "@/components/shared/icons/files/sheet";
import SlidesIcon from "@/components/shared/icons/files/slides";
import VideoIcon from "@/components/shared/icons/files/video";

export function fileIcon({
  fileType,
  className = "mx-auto h-6 w-6",
  isLight = true,
}: {
  fileType: string;
  className?: string;
  isLight?: boolean;
}) {
  switch (fileType) {
    case "pdf":
    case "application/pdf":
      return <PdfIcon className={className} isLight={isLight} />;
    case "image/png":
    case "image/jpeg":
    case "image/jpg":
    case "image":
      return <ImageFileIcon className={className} isLight={isLight} />;
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/msword":
    case "application/vnd.oasis.opendocument.text":
    case "text/plain":
    case "text/markdown":
    case "docs":
      return <DocsIcon className={className} isLight={isLight} />;
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    case "application/vnd.ms-powerpoint":
    case "application/vnd.oasis.opendocument.presentation":
    case "application/vnd.apple.keynote":
    case "application/x-iwork-keynote-sffkey":
    case "slides":
      return <SlidesIcon className={className} isLight={isLight} />;
    case "application/vnd.ms-excel":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "text/csv":
    case "text/tab-separated-values":
    case "application/vnd.oasis.opendocument.spreadsheet":
    case "sheet":
      return <SheetIcon className={className} isLight={isLight} />;
    case "notion":
      return <NotionIcon className={className} />;
    case "link":
      return <LinkIcon className={className} />;
    case "image/vnd.dwg":
    case "image/vnd.dxf":
    case "cad":
      return <CadIcon className={className} isLight={isLight} />;
    case "video/mp4":
    case "video/quicktime":
    case "video/webm":
    case "video/ogg":
    case "video/x-msvideo":
    case "video":
    case "audio/mp4":
    case "audio/mpeg":
      return <VideoIcon className={className} isLight={isLight} />;
    case "application/vnd.google-earth.kml+xml":
    case "application/vnd.google-earth.kmz":
    case "map":
      return <MapIcon className={className} isLight={isLight} />;
    case "application/vnd.ms-outlook":
    case "email":
      return <MailIcon className={className} />;
    case "text/html":
    case "html":
      return <FileCode className={className} />;
    default:
      return <FileIcon className={className} />;
  }
}
