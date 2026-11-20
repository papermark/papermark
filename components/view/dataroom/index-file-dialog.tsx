import { useState } from "react";

import {
  FileJson,
  FileSlidersIcon,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useAnalytics } from "@/lib/analytics";
import { IndexFileFormat } from "@/lib/types/index-file";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface IndexFileDialogProps {
  linkId: string;
  viewId: string;
  disabled?: boolean;
  dataroomId: string;
  viewerEmail?: string;
  viewerId?: string;
  isPreview?: boolean;
  /** Optional className applied to the trigger button so callers can override
   *  the default outline styling (e.g. theme it to a viewer surface color). */
  triggerClassName?: string;
}

export default function IndexFileDialog({
  linkId,
  viewId,
  disabled = false,
  dataroomId,
  viewerEmail,
  viewerId,
  isPreview,
  triggerClassName,
}: IndexFileDialogProps) {
  const { t } = useTranslation("dataroom");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFormat, setSelectedFormat] =
    useState<IndexFileFormat>("excel");
  const [isOpen, setIsOpen] = useState(false);
  const analytics = useAnalytics();

  const handleGenerateIndex = async () => {
    if (isPreview) {
      toast.error(
        t(
          "indexFile.previewDisabled",
          "Generating an index file isn't available in preview mode.",
        ),
      );
      return;
    }

    if (!linkId) {
      toast.error(t("indexFile.genericError", "Something went wrong. Please try again."));
      return;
    }

    try {
      setIsLoading(true);

      const response = await fetch(`/api/links/generate-index`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          linkId,
          format: selectedFormat,
          dataroomId,
          viewId,
          viewerId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t("indexFile.errorToast", "Failed to generate index"));
      }
      analytics.identify(viewerEmail);
      analytics.capture("Generated Index File by visitor", {
        linkId: linkId,
        dataroomId: dataroomId,
        linkType: "dataroom",
        viewerId: viewerId,
        viewerEmail: viewerEmail,
        format: selectedFormat,
        viewId: viewId,
      });

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get("Content-Disposition");
      const filename = contentDisposition?.split("filename=")[1] || "index";

      // Create a blob from the response
      const blob = await response.blob();

      // Create a download link and trigger it
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(link);
      }, 100);

      toast.success(t("indexFile.successToast", "Index file generated successfully"));
      setIsOpen(false);
    } catch (error) {
      console.error("Error generating index:", error);
      toast.error(
        error instanceof Error ? error.message : t("indexFile.errorToast", "Failed to generate index"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (open && isPreview) {
      toast.error(
        t(
          "indexFile.previewDisabled",
          "Generating an index file isn't available in preview mode.",
        ),
      );
      return;
    }
    setIsOpen(open);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className={triggerClassName}
        >
          <FileSlidersIcon />
          {t("indexFile.trigger", "Generate Index File")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("indexFile.title", "Generate Dataroom Index File")}</DialogTitle>
          <DialogDescription>{t("indexFile.description", "Select a format to generate the index file.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <h4 className="text-sm font-medium">
              {t("indexFile.selectFormat", "Select Format")}
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={selectedFormat === "excel" ? "default" : "outline"}
                onClick={() => {
                  setSelectedFormat("excel");
                }}
                className="justify-start"
                size="sm"
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Excel
              </Button>
              <Button
                variant={selectedFormat === "csv" ? "default" : "outline"}
                onClick={() => setSelectedFormat("csv")}
                className="justify-start"
                size="sm"
              >
                <FileText className="mr-2 h-4 w-4" />
                CSV
              </Button>
              <Button
                variant={selectedFormat === "json" ? "default" : "outline"}
                onClick={() => setSelectedFormat("json")}
                className="justify-start"
                size="sm"
              >
                <FileJson className="mr-2 h-4 w-4" />
                JSON
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleGenerateIndex}
            disabled={isLoading || disabled}
          >
            {isLoading ? t("indexFile.generating", "Generating...") : t("indexFile.generate", "Generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
