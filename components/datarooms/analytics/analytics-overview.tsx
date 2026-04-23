import Link from "next/link";

import { useMemo } from "react";

import { FileIcon } from "lucide-react";

import { useDataroomDocumentStats } from "@/lib/swr/use-dataroom-document-stats";
import { useDataroomStats } from "@/lib/swr/use-dataroom-stats";

import StatsChart from "@/components/documents/stats-chart";
import ChevronRight from "@/components/shared/icons/chevron-right";

interface DataroomAnalyticsOverviewProps {
  selectedDocument: {
    id: string;
    name: string;
  } | null;
  setSelectedDocument: React.Dispatch<
    React.SetStateAction<{
      id: string;
      name: string;
    } | null>
  >;
}

export default function DataroomAnalyticsOverview({
  selectedDocument,
  setSelectedDocument,
}: DataroomAnalyticsOverviewProps) {
  const {
    stats: dataroomStats,
    loading: dataroomLoading,
    error: dataroomError,
  } = useDataroomStats();

  // Memoize the most viewed document calculation
  const mostViewedDocument = useMemo(() => {
    if (!dataroomStats || selectedDocument) return null;

    // Group views by document ID and count them
    const viewsByDocument = dataroomStats.documentViews.reduce(
      (acc, view) => {
        if (!view.documentId) return acc;

        if (!acc[view.documentId]) {
          acc[view.documentId] = { count: 0, name: "" };
        }
        acc[view.documentId].count += 1;
        return acc;
      },
      {} as Record<string, { count: number; name: string }>,
    );

    // Find document with most views
    let maxViews = 0;
    let mostViewedId = "";
    Object.entries(viewsByDocument).forEach(([docId, data]) => {
      if (data.count > maxViews) {
        maxViews = data.count;
        mostViewedId = docId;
      }
    });

    // Return the most viewed document if found
    return mostViewedId
      ? {
          id: mostViewedId,
          name: mostViewedId, // We'll update the name once we have it
        }
      : null;
  }, [dataroomStats, selectedDocument]);

  // Get document stats for either selected document or most viewed document
  const documentId = selectedDocument?.id || mostViewedDocument?.id;
  const {
    stats: documentStats,
    loading: documentLoading,
    error: documentError,
  } = useDataroomDocumentStats(documentId);

  // If neither is selected or we're still loading dataroom stats
  const loading = documentLoading || (dataroomLoading && !documentId);
  const error = documentError || (dataroomError && !documentId);

  if (loading) {
    return <div>Loading analytics...</div>;
  }

  if (error) {
    return <div>Error loading analytics</div>;
  }

  const completionRate = 0;

  // Get display name for the currently viewed document
  const displayName =
    selectedDocument?.name ||
    (mostViewedDocument?.name !== mostViewedDocument?.id
      ? mostViewedDocument?.name
      : "Most viewed document");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6">
        <div>
          <div className="mb-4 flex flex-col justify-between gap-2">
            <h3 className="text-lg font-medium">
              {displayName ? displayName : "Document Engagement"}
            </h3>
            {documentId && (
              <Link
                href={`/documents/${documentId}`}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4 transition-transform duration-200" />
                <FileIcon className="h-4 w-4 text-[#fb7a00]" />{" "}
                <span>To full document analytics</span>
              </Link>
            )}
          </div>
          {documentStats && (
            <StatsChart
              documentId={documentId || ""}
              totalPagesMax={documentStats?.totalPagesMax || 0}
              statsData={{
                stats: documentStats,
                loading: false,
                error: null,
              }}
            />
          )}
        </div>

        {/* INFO: hiding completion rate for now */}
        {/* <div className="flex flex-col items-center justify-center rounded-lg border p-6">
          <h3 className="mb-4 text-lg font-medium">
            {displayName
              ? `${displayName} - Completion Rate`
              : "Completion Rate"}
          </h3>
          <div className="flex flex-col items-center">
            <Gauge value={completionRate} size="large" showValue={true} />
            <p className="mt-4 text-sm text-muted-foreground">
              Document has {documentStats?.totalViews || 0} view
              {documentStats?.totalViews !== 1 ? "s" : ""} in this dataroom
            </p>
            {!selectedDocument && mostViewedDocument && (
              <button
                onClick={() => setSelectedDocument(mostViewedDocument)}
                className="mt-2 text-xs text-primary hover:underline"
              >
                View all documents
              </button>
            )}
          </div>
        </div> */}
      </div>
    </div>
  );
}
