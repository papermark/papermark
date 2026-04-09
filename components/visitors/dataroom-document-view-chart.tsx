import { DownloadCloudIcon } from "lucide-react";

import { useDataroomDocumentViewStats } from "@/lib/swr/use-dataroom";
import { durationFormat } from "@/lib/utils";

import BarChartComponent from "@/components/charts/bar-chart";

import { Skeleton } from "../ui/skeleton";

interface DataroomDocumentViewChartProps {
  dataroomId: string;
  documentId: string;
  viewId: string;
  downloadType?: "SINGLE" | "BULK" | "FOLDER" | null;
  downloadMetadata?: {
    folderName?: string;
    folderPath?: string;
    dataroomName?: string;
    documentCount?: number;
    documents?: {
      id: string;
      name: string;
    }[];
  } | null;
}

export default function DataroomDocumentViewChart({
  dataroomId,
  documentId,
  viewId,
  downloadType,
  downloadMetadata,
}: DataroomDocumentViewChartProps) {
  const { stats, loading, error } = useDataroomDocumentViewStats({
    dataroomId,
    documentId,
    viewId,
  });

  if (loading) {
    return (
      <div className="p-4">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Unable to load page analytics
      </div>
    );
  }

  if (!stats?.duration.data) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No page view data available
      </div>
    );
  }

  // Check if this is a download-only view (no pages viewed)
  const hasViewData = stats.duration.data.some(
    (item) => item.sum_duration > 0,
  );

  // If no view data and it's a download (any type), show a message instead of the graph
  if (!hasViewData && downloadType) {
    let downloadMessage = "";

    if (downloadType === "FOLDER" && downloadMetadata?.folderName) {
      downloadMessage = `Downloaded without viewing via dataroom folder "${downloadMetadata.folderName}"`;
    } else if (downloadType === "BULK" && downloadMetadata?.dataroomName) {
      downloadMessage = `Downloaded without viewing via bulk download from "${downloadMetadata.dataroomName}" dataroom`;
    } else if (downloadType === "BULK") {
      downloadMessage = "Downloaded without viewing via bulk dataroom download";
    } else if (downloadType === "SINGLE") {
      downloadMessage = "Downloaded without viewing";
    }

    return (
      <div className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <DownloadCloudIcon className="h-4 w-4" />
          <span>{downloadMessage}</span>
        </div>
      </div>
    );
  }

  // Build full page data array (fill in missing pages with 0 duration)
  let durationData = Array.from({ length: stats.numPages || 0 }, (_, i) => ({
    pageNumber: (i + 1).toString(),
    sum_duration: 0,
  }));

  durationData = durationData.map((item) => {
    const dataItem = stats.duration.data.find(
      (data) => data.pageNumber === item.pageNumber,
    );
    return dataItem ? dataItem : item;
  });

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Time spent per page</div>
        <div className="text-xs text-muted-foreground">
          Total: {durationFormat(stats.total_duration)}
        </div>
      </div>
      <div className="rounded-lg border bg-background p-2">
        <BarChartComponent
          data={durationData}
          isSum={true}
          versionNumber={stats.versionNumber}
        />
      </div>
    </div>
  );
}
