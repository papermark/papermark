import { useState } from "react";

import { EyeIcon, EyeOffIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { ButtonTooltip } from "@/components/ui/tooltip";

import { DocumentPreviewModal } from "./document-preview-modal";

interface DocumentPreviewButtonProps {
  documentId: string;
  primaryVersion?: {
    hasPages?: boolean;
    type?: string | null;
    numPages?: number | null;
  };
  advancedExcelEnabled?: boolean;
  isProcessing?: boolean;
  variant?: "ghost" | "outline" | "default";
  size?: "sm" | "default" | "lg" | "icon";
  children?: React.ReactNode;
  className?: string;
  showTooltip?: boolean;
}

export function DocumentPreviewButton({
  documentId,
  primaryVersion,
  advancedExcelEnabled = false,
  isProcessing = false,
  variant = "ghost",
  size = "icon",
  children,
  className,
  showTooltip = true,
}: DocumentPreviewButtonProps) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Check if document type supports preview
  const supportsPreview = () => {
    if (!primaryVersion) return false;

    // Support documents with pages (PDFs, docs, slides, etc.)
    if (primaryVersion.hasPages) return true;

    // Support image documents
    if (primaryVersion.type === "image") return true;

    // Support Excel sheets with advanced mode enabled
    if (primaryVersion.type === "sheet" && advancedExcelEnabled) return true;

    return false;
  };

  // Don't render if document type doesn't support preview
  if (!supportsPreview()) {
    return null;
  }

  const handlePreviewClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();

    if (isProcessing) return;
    setIsPreviewOpen(true);
  };

  // Stop propagation on the container to prevent parent click handlers from firing
  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  const button = (
    <Button
      variant={variant}
      size={size}
      onClick={handlePreviewClick}
      disabled={isProcessing}
      className={cn(
        size !== "icon" &&
          "max-md:h-8 max-md:w-8 max-md:min-w-8 max-md:shrink-0 max-md:gap-0 max-md:px-0 max-md:[&_svg]:size-4",
        className,
      )}
    >
      {children || (
        <>
          <EyeIcon className="h-4 w-4" />
          {size !== "icon" && (
            <span className="ml-1 hidden md:inline">Preview</span>
          )}
        </>
      )}
    </Button>
  );

  const wrappedButton = showTooltip ? (
    <ButtonTooltip
      content={
        isProcessing
          ? "Document is still processing"
          : "Quick preview of document"
      }
    >
      {button}
    </ButtonTooltip>
  ) : (
    button
  );

  return (
    <div onClick={handleContainerClick} onMouseDown={handleContainerClick}>
      {wrappedButton}
      <DocumentPreviewModal
        documentId={documentId}
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
      />
    </div>
  );
}

// Helper function to check if document is processing
export function isDocumentProcessing(primaryVersion?: {
  hasPages?: boolean;
  type?: string | null;
  numPages?: number | null;
}) {
  if (!primaryVersion) return false;

  // Check if document type should have pages but doesn't
  const shouldHavePages = ["pdf", "docs", "slides", "cad"].includes(
    primaryVersion.type || "",
  );

  return shouldHavePages && !primaryVersion.hasPages;
}
