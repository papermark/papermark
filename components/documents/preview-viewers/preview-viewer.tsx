import { useTeam } from "@/context/team-context";

import { DocumentPreviewData } from "@/lib/types/document-preview";

import { PreviewExcelViewer } from "./preview-excel-viewer";
import { PreviewImageViewer } from "./preview-image-viewer";
import { PreviewPagesViewer } from "./preview-pages-viewer";

interface PreviewViewerProps {
  documentData: DocumentPreviewData;
  onClose: () => void;
}

export function PreviewViewer({ documentData, onClose }: PreviewViewerProps) {
  const { currentTeamId } = useTeam();

  const previewPagesEndpoint = currentTeamId
    ? `/api/teams/${currentTeamId}/documents/${documentData.documentId}/preview-pages`
    : undefined;

  const renderViewer = () => {
    // Documents with pages (PDFs, docs, slides)
    if (documentData.pages && documentData.pages.length > 0) {
      return (
        <PreviewPagesViewer
          documentData={documentData}
          onClose={onClose}
          pagesApiEndpoint={previewPagesEndpoint}
        />
      );
    }

    // Single image files
    if (documentData.fileType === "image" && documentData.file) {
      return (
        <PreviewImageViewer documentData={documentData} onClose={onClose} />
      );
    }

    // Excel/CSV files with advanced mode
    if (
      documentData.fileType === "sheet" &&
      documentData.advancedExcelEnabled &&
      documentData.file
    ) {
      return (
        <PreviewExcelViewer documentData={documentData} onClose={onClose} />
      );
    }

    // Excel/CSV files without advanced mode
    if (documentData.fileType === "sheet") {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <div className="text-center">
            <p className="text-gray-400">
              Enable advanced Excel mode to preview this document.
            </p>
          </div>
        </div>
      );
    }

    // Notion documents (not fully supported yet)
    if (documentData.fileType === "notion") {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <div className="text-center">
            <p className="text-gray-400">Notion document preview coming soon</p>
          </div>
        </div>
      );
    }

    // Fallback for unsupported types
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400">
            Preview not available for this document type
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="relative h-full w-full rounded-lg bg-gray-900">
      {renderViewer()}
    </div>
  );
}
