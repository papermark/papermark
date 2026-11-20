import ErrorPage from "next/error";

import { DownloadCloudIcon } from "lucide-react";

import BarChartComponent from "@/components/charts/bar-chart";

import { useVisitorStats } from "@/lib/swr/use-stats";

import StatsChartSkeleton from "../documents/stats-chart-skeleton";

export default function VisitorChart({
  documentId,
  viewId,
  totalPages = 0,
  versionNumber,
  downloadType,
  downloadMetadata,
}: {
  documentId: string;
  viewId: string;
  totalPages?: number;
  versionNumber?: number;
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
}) {
  const { stats, error } = useVisitorStats(viewId, documentId);

  if (error && error.status === 404) {
    return <ErrorPage statusCode={404} />;
  }

  if (!stats?.duration.data) {
    return <StatsChartSkeleton />;
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
      <div className="rounded-bl-lg border-b border-l p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <DownloadCloudIcon className="h-4 w-4" />
          <span>{downloadMessage}</span>
        </div>
      </div>
    );
  }

  let durationData = Array.from({ length: totalPages }, (_, i) => ({
    pageNumber: (i + 1).toString(),
    sum_duration: 0,
  }));

  const swrData = stats?.duration;

  durationData = durationData.map((item) => {
    const swrItem = swrData.data.find(
      (data) => data.pageNumber === item.pageNumber,
    );
    return swrItem ? swrItem : item;
  });

  return (
    <div className="rounded-bl-lg border-b border-l pb-0.5 pl-0.5 md:pb-1 md:pl-1">
      <BarChartComponent
        data={durationData}
        isSum={true}
        versionNumber={versionNumber}
      />
    </div>
  );
}
