import Link from "next/link";

import { useState } from "react";

import {
  ArrowUpRightIcon,
  ChevronRightIcon,
  DownloadCloudIcon,
  FileCheckIcon,
  FileIcon,
  UploadCloudIcon,
} from "lucide-react";

import { useTeam } from "@/context/team-context";
import { useDataroomVisitHistory } from "@/lib/swr/use-dataroom";
import {
  DocumentViewStats,
  useDataroomViewDocumentStats,
} from "@/lib/swr/use-dataroom-view-document-stats";
import { cn, durationFormat, timeAgo } from "@/lib/utils";

import { Gauge } from "@/components/ui/gauge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { TimestampTooltip } from "@/components/ui/timestamp-tooltip";

import { DocumentPageChart } from "./document-view-stats";
import VisitorVideoChart from "./visitor-video-chart";

export function DataroomViewStats({
  viewId,
  dataroomId,
  isExpanded,
}: {
  viewId: string;
  dataroomId: string;
  isExpanded: boolean;
}) {
  const { documentViews, uploadedDocumentViews } = useDataroomVisitHistory({
    viewId,
    dataroomId,
  });

  const { documentStats, loading: statsLoading } = useDataroomViewDocumentStats(
    {
      dataroomId,
      dataroomViewId: viewId,
      enabled: isExpanded,
    },
  );

  const statsMap = new Map<string, DocumentViewStats>();
  documentStats?.forEach((s) => {
    statsMap.set(s.viewId, s);
  });

  const groupedViews = documentViews
    ? documentViews.reduce(
        (acc, view) => {
          if (view.downloadType === "BULK" || view.downloadType === "FOLDER") {
            const key = `${view.downloadType}-${new Date(view.viewedAt).toISOString()}`;
            if (!acc.bulkDownloads[key]) {
              acc.bulkDownloads[key] = {
                type: view.downloadType,
                viewedAt: view.viewedAt,
                downloadedAt: view.downloadedAt,
                metadata: view.downloadMetadata,
                documents: [],
              };
            }
            acc.bulkDownloads[key].documents.push(view);
          } else {
            acc.individualViews.push(view);
          }
          return acc;
        },
        {
          individualViews: [] as typeof documentViews,
          bulkDownloads: {} as Record<
            string,
            {
              type: string;
              viewedAt: string;
              downloadedAt: string;
              metadata?: {
                folderName?: string;
                folderPath?: string;
                dataroomName?: string;
                documentCount?: number;
                documents?: {
                  id: string;
                  name: string;
                }[];
              };
              documents: typeof documentViews;
            }
          >,
        },
      )
    : { individualViews: [], bulkDownloads: {} };

  const allEvents: Array<{
    type: "upload" | "view" | "download" | "bulk-download";
    timestamp: Date;
    data: any;
  }> = [];

  uploadedDocumentViews?.forEach((upload) => {
    allEvents.push({
      type: "upload",
      timestamp: new Date(upload.uploadedAt),
      data: upload,
    });
  });

  Object.entries(groupedViews.bulkDownloads).forEach(([_key, bulkGroup]) => {
    allEvents.push({
      type: "bulk-download",
      timestamp: new Date(bulkGroup.downloadedAt),
      data: bulkGroup,
    });
  });

  groupedViews.individualViews.forEach((view) => {
    const viewedAtTime = new Date(view.viewedAt).getTime();
    const downloadedAtTime = view.downloadedAt
      ? new Date(view.downloadedAt).getTime()
      : null;
    const isDownloadOnly =
      downloadedAtTime && Math.abs(viewedAtTime - downloadedAtTime) < 1000;

    if (!isDownloadOnly) {
      allEvents.push({
        type: "view",
        timestamp: new Date(view.viewedAt),
        data: view,
      });
    }

    if (view.downloadedAt) {
      allEvents.push({
        type: "download",
        timestamp: new Date(view.downloadedAt),
        data: view,
      });
    }
  });

  allEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return (
    <>
      {allEvents.length > 0 ? (
        allEvents.map((event, index) => {
          if (event.type === "upload") {
            return (
              <UploadRow
                key={`upload-${event.data.documentId}-${index}`}
                upload={event.data}
                timestamp={event.timestamp}
              />
            );
          }

          if (event.type === "bulk-download") {
            return (
              <BulkDownloadRow
                key={`bulk-${index}`}
                bulkGroup={event.data}
                timestamp={event.timestamp}
              />
            );
          }

          if (event.type === "view") {
            const view = event.data;
            const stats = statsMap.get(view.id);
            return (
              <DocumentViewRow
                key={`view-${view.id}`}
                view={view}
                stats={stats}
                statsLoading={statsLoading}
                dataroomId={dataroomId}
                dataroomViewId={viewId}
                timestamp={event.timestamp}
              />
            );
          }

          if (event.type === "download") {
            const view = event.data;
            return (
              <DownloadRow
                key={`download-${view.id}`}
                view={view}
                timestamp={event.timestamp}
              />
            );
          }

          return null;
        })
      ) : documentViews === undefined ? (
        <TableRow className="[&>td]:py-3">
          <TableCell>
            <Skeleton className="h-6 w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-6 w-16" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-6 w-6 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-6 w-16" />
          </TableCell>
          <TableCell />
        </TableRow>
      ) : null}
    </>
  );
}

function DocumentViewRow({
  view,
  stats,
  statsLoading,
  dataroomId,
  dataroomViewId,
  timestamp,
}: {
  view: any;
  stats: DocumentViewStats | undefined;
  statsLoading: boolean;
  dataroomId: string;
  dataroomViewId: string;
  timestamp: Date;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const teamId = useTeam()?.currentTeam?.id;
  const documentType =
    stats?.documentType ??
    view.document?.type ??
    view.document?.versions?.[0]?.type ??
    null;
  const isVideo = documentType === "video";
  const hasPages = Boolean(stats && stats.totalPages > 0);
  const canExpand = isVideo || hasPages;

  return (
    <>
      <TableRow className="[&>td]:py-3">
        <TableCell>
          <div className="flex items-center gap-x-4 overflow-visible">
            <FileCheckIcon className="h-5 w-5 shrink-0 text-[#fb7a00]" />

            <div className="flex items-center gap-x-2">
              <span className="truncate">Viewed {view.document.name}</span>
              <Link
                href={`/documents/${view.document.id}`}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowUpRightIcon className="h-4 w-4" />
              </Link>
            </div>
            {canExpand && (
              <button
                onClick={() => setShowDetail((prev) => !prev)}
                className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronRightIcon
                  className={cn(
                    "h-3 w-3 transition-transform",
                    showDetail && "rotate-90",
                  )}
                />
                <span className="hidden sm:inline">
                  {isVideo ? "playback" : "page-by-page"}
                </span>
              </button>
            )}
          </div>
        </TableCell>
        <TableCell>
          {statsLoading ? (
            <Skeleton className="h-4 w-14" />
          ) : stats ? (
            <span className="text-sm text-muted-foreground">
              {durationFormat(stats.totalDuration)}
            </span>
          ) : null}
        </TableCell>
        <TableCell>
          {statsLoading ? (
            <Skeleton className="h-6 w-6 rounded-full" />
          ) : stats ? (
            <Gauge value={stats.completionRate} size={"xs"} showValue={true} />
          ) : null}
        </TableCell>
        <TableCell>
          <TimestampTooltip
            timestamp={timestamp}
            side="right"
            rows={["local", "utc", "unix"]}
          >
            <time
              className="select-none truncate text-sm text-muted-foreground"
              dateTime={timestamp.toISOString()}
            >
              {timeAgo(timestamp)}
            </time>
          </TimestampTooltip>
        </TableCell>
        <TableCell />
      </TableRow>
      {showDetail && isVideo && view.document?.id && teamId ? (
        <TableRow>
          <TableCell colSpan={5} className="p-0 px-4 pb-3 pt-0">
            <VisitorVideoChart
              documentId={view.document.id}
              viewId={view.id}
              teamId={teamId}
            />
          </TableCell>
        </TableRow>
      ) : null}
      {showDetail && hasPages && !isVideo && stats ? (
        <TableRow>
          <TableCell colSpan={5} className="p-0 px-4 pb-3 pt-0">
            <DocumentPageChart
              dataroomId={dataroomId}
              dataroomViewId={dataroomViewId}
              documentViewId={view.id}
              documentId={view.document.id}
              totalPages={stats.totalPages}
              downloadType={view.downloadType}
              downloadMetadata={view.downloadMetadata}
            />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function UploadRow({ upload, timestamp }: { upload: any; timestamp: Date }) {
  return (
    <TableRow className="[&>td]:py-3">
      <TableCell>
        <div className="flex items-center gap-x-4 overflow-visible">
          <UploadCloudIcon className="h-5 w-5 text-[#fb7a00]" />
          <span className="truncate">Uploaded {upload.originalFilename}</span>
          <Link
            href={`/documents/${upload.documentId}`}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowUpRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </TableCell>
      <TableCell />
      <TableCell />
      <TableCell>
        <TimestampTooltip
          timestamp={timestamp}
          side="right"
          rows={["local", "utc", "unix"]}
        >
          <time
            className="select-none truncate text-sm text-muted-foreground"
            dateTime={timestamp.toISOString()}
          >
            {timeAgo(timestamp)}
          </time>
        </TimestampTooltip>
      </TableCell>
      <TableCell />
    </TableRow>
  );
}

function DownloadRow({ view, timestamp }: { view: any; timestamp: Date }) {
  return (
    <TableRow className="[&>td]:py-3">
      <TableCell>
        <div className="flex items-center gap-x-4 overflow-visible">
          <DownloadCloudIcon className="h-5 w-5 text-[#fb7a00]" />
          <span className="truncate">Downloaded {view.document.name}</span>
          <Link
            href={`/documents/${view.document.id}`}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowUpRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </TableCell>
      <TableCell />
      <TableCell />
      <TableCell>
        <TimestampTooltip
          timestamp={timestamp}
          side="right"
          rows={["local", "utc", "unix"]}
        >
          <time
            className="select-none truncate text-sm text-muted-foreground"
            dateTime={timestamp.toISOString()}
          >
            {timeAgo(timestamp)}
          </time>
        </TimestampTooltip>
      </TableCell>
      <TableCell />
    </TableRow>
  );
}

function BulkDownloadRow({
  bulkGroup,
  timestamp,
}: {
  bulkGroup: any;
  timestamp: Date;
}) {
  const documentCount =
    bulkGroup.metadata?.documentCount || bulkGroup.documents.length;
  const hasDocumentList =
    bulkGroup.metadata?.documents && bulkGroup.metadata.documents.length > 0;

  return (
    <TableRow className="[&>td]:py-3">
      <TableCell>
        <div className="flex items-center gap-x-4 overflow-visible">
          <DownloadCloudIcon className="h-5 w-5 text-[#fb7a00]" />
          <span>
            Downloaded{" "}
            {hasDocumentList ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="underline decoration-dotted hover:text-primary">
                    {documentCount} document
                    {documentCount !== 1 ? "s" : ""}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80">
                  <div className="space-y-2">
                    <h4 className="font-medium leading-none">
                      {bulkGroup.type === "FOLDER" &&
                      bulkGroup.metadata?.folderName
                        ? `Files in ${bulkGroup.metadata.folderName}`
                        : `Files in ${bulkGroup.metadata?.dataroomName || "dataroom"}`}
                    </h4>
                    <ScrollArea className="h-[200px] w-full rounded-md border p-2">
                      <div className="space-y-1">
                        {bulkGroup.metadata.documents!.map(
                          (doc: { id: string; name: string }) => (
                            <div
                              key={doc.id}
                              className="flex items-center gap-2 text-sm"
                            >
                              <FileIcon className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate">{doc.name}</span>
                            </div>
                          ),
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <>
                {documentCount} document
                {documentCount !== 1 ? "s" : ""}
              </>
            )}{" "}
            {bulkGroup.type === "FOLDER" && bulkGroup.metadata?.folderName ? (
              <>
                from folder{" "}
                <span className="font-medium">
                  {bulkGroup.metadata.folderName}
                </span>
              </>
            ) : bulkGroup.type === "BULK" &&
              bulkGroup.metadata?.dataroomName ? (
              <>
                from{" "}
                <span className="font-medium">
                  {bulkGroup.metadata.dataroomName}
                </span>{" "}
                dataroom
              </>
            ) : (
              "via bulk download"
            )}
          </span>
        </div>
      </TableCell>
      <TableCell />
      <TableCell />
      <TableCell>
        <TimestampTooltip
          timestamp={timestamp}
          side="right"
          rows={["local", "utc", "unix"]}
        >
          <time
            className="select-none truncate text-sm text-muted-foreground"
            dateTime={timestamp.toISOString()}
          >
            {timeAgo(timestamp)}
          </time>
        </TimestampTooltip>
      </TableCell>
      <TableCell />
    </TableRow>
  );
}
