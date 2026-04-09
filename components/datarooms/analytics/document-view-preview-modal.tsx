import { useState } from "react";

import { useTeam } from "@/context/team-context";
import {
  BadgeCheckIcon,
  ChevronDownIcon,
  DownloadCloudIcon,
  Eye,
  FileDigitIcon,
  XIcon,
} from "lucide-react";
import useSWR from "swr";

import {
  DataroomDocumentViewStats,
  useDataroomDocumentViewStats,
} from "@/lib/swr/use-dataroom";
import { cn, durationFormat, fetcher, timeAgo } from "@/lib/utils";

import BarChartComponent from "@/components/charts/bar-chart";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { VisitorAvatar } from "@/components/visitors/visitor-avatar";

interface DocumentViewPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  dataroomId: string;
  document: {
    id: string;
    documentId: string;
    name: string;
    views: number;
    downloads: number;
  };
}

interface DocumentView {
  id: string;
  viewerEmail: string | null;
  viewerName: string | null;
  viewedAt: string;
  downloadedAt: string | null;
  totalDuration: number;
  verified: boolean;
  versionNumber: number;
  numPages: number;
}

export function DocumentViewPreviewModal({
  isOpen,
  onClose,
  dataroomId,
  document,
}: DocumentViewPreviewModalProps) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  // Fetch views for this document in the dataroom
  const { data: viewsData, error: viewsError } = useSWR<{
    views: DocumentView[];
  }>(
    isOpen && teamId && dataroomId && document.documentId
      ? `/api/teams/${teamId}/datarooms/${dataroomId}/documents/${document.documentId}/views`
      : null,
    fetcher,
    { dedupingInterval: 10000 },
  );

  const views = viewsData?.views || [];
  const isLoading = !viewsData && !viewsError;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4">
          <div className="flex items-start justify-between pr-8">
            <div>
              <DialogTitle className="text-lg font-semibold">
                {document.name}
              </DialogTitle>
              <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Eye className="h-4 w-4" />
                  {document.views} view{document.views !== 1 ? "s" : ""}
                </span>
                {document.downloads > 0 && (
                  <span className="flex items-center gap-1">
                    <DownloadCloudIcon className="h-4 w-4" />
                    {document.downloads} download
                    {document.downloads !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-80px)]">
          <div className="p-6">
            <h3 className="mb-4 text-sm font-medium text-muted-foreground">
              Visitors ({views.length})
            </h3>

            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : views.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                No views yet for this document
              </div>
            ) : (
              <div className="space-y-2">
                {views.map((view, index) => (
                  <VisitorRow
                    key={view.id}
                    view={view}
                    dataroomId={dataroomId}
                    documentId={document.documentId}
                    defaultOpen={index === 0}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function VisitorRow({
  view,
  dataroomId,
  documentId,
  defaultOpen = false,
}: {
  view: DocumentView;
  dataroomId: string;
  documentId: string;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border bg-card">
        <CollapsibleTrigger asChild>
          <div className="flex cursor-pointer items-center justify-between p-4 transition-colors hover:bg-muted/50">
            <div className="flex items-center gap-3">
              <VisitorAvatar viewerEmail={view.viewerEmail} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {view.viewerName || view.viewerEmail || "Anonymous"}
                  {view.verified && (
                    <BadgeCheckIcon className="h-4 w-4 text-emerald-500" />
                  )}
                </p>
                {view.viewerName && view.viewerEmail && (
                  <p className="text-xs text-muted-foreground">
                    {view.viewerEmail}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right text-sm">
                <p className="text-muted-foreground">
                  {durationFormat(view.totalDuration)}
                </p>
                <p className="text-xs text-muted-foreground/60">
                  {timeAgo(view.viewedAt)}
                </p>
              </div>
              <ChevronDownIcon
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-200",
                  isOpen && "rotate-180",
                )}
              />
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t bg-muted/30 p-4">
            <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
              <FileDigitIcon className="h-3.5 w-3.5" />
              Document Version {view.versionNumber}
            </div>
            <VisitorPageChart
              dataroomId={dataroomId}
              documentId={documentId}
              viewId={view.id}
              numPages={view.numPages}
            />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function VisitorPageChart({
  dataroomId,
  documentId,
  viewId,
  numPages,
}: {
  dataroomId: string;
  documentId: string;
  viewId: string;
  numPages: number;
}) {
  const { stats, loading, error } = useDataroomDocumentViewStats({
    dataroomId,
    documentId,
    viewId,
  });

  if (loading) {
    return <Skeleton className="h-32 w-full" />;
  }

  if (error || !stats?.duration.data) {
    return (
      <div className="text-sm text-muted-foreground">
        Unable to load page analytics
      </div>
    );
  }

  // Check if there's any view data
  const hasViewData = stats.duration.data.some(
    (item) => item.sum_duration > 0,
  );

  if (!hasViewData) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <DownloadCloudIcon className="h-4 w-4" />
        <span>Downloaded without viewing</span>
      </div>
    );
  }

  // Build full page data array
  let durationData = Array.from({ length: numPages || stats.numPages || 0 }, (_, i) => ({
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
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Time spent per page</span>
        <span className="text-muted-foreground">
          Total: {durationFormat(stats.total_duration)}
        </span>
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
