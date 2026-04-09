import Link from "next/link";

import { useState } from "react";

import {
  ChevronDownIcon,
  DownloadCloudIcon,
  FileCheckIcon,
  FileIcon,
  UploadCloudIcon,
} from "lucide-react";

import { useDataroomVisitHistory } from "@/lib/swr/use-dataroom";
import { cn, timeAgo } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { TimestampTooltip } from "@/components/ui/timestamp-tooltip";

import DataroomDocumentViewChart from "./dataroom-document-view-chart";

export default function DataroomVisitHistory({
  viewId,
  dataroomId,
}: {
  viewId: string;
  dataroomId: string;
}) {
  const { documentViews, uploadedDocumentViews } = useDataroomVisitHistory({
    viewId,
    dataroomId,
  });

  // Group bulk and folder downloads together
  const groupedViews = documentViews
    ? documentViews.reduce(
        (acc, view) => {
          if (view.downloadType === "BULK" || view.downloadType === "FOLDER") {
            // Group bulk/folder downloads by type and timestamp
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
            // Keep individual views
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

  // Combine and sort all events chronologically (oldest to newest)
  const allEvents: Array<{
    type: "upload" | "view" | "download" | "bulk-download";
    timestamp: Date;
    data: any;
  }> = [];

  // Add uploads
  uploadedDocumentViews?.forEach((upload) => {
    allEvents.push({
      type: "upload",
      timestamp: new Date(upload.uploadedAt),
      data: upload,
    });
  });

  // Add bulk/folder downloads
  Object.entries(groupedViews.bulkDownloads).forEach(([key, bulkGroup]) => {
    allEvents.push({
      type: "bulk-download",
      timestamp: new Date(bulkGroup.downloadedAt),
      data: bulkGroup,
    });
  });

  // Add individual views
  groupedViews.individualViews.forEach((view) => {
    const viewedAtTime = new Date(view.viewedAt).getTime();
    const downloadedAtTime = view.downloadedAt
      ? new Date(view.downloadedAt).getTime()
      : null;
    const isDownloadOnly =
      downloadedAtTime && Math.abs(viewedAtTime - downloadedAtTime) < 1000;

    // Add view event (if not download-only)
    if (!isDownloadOnly) {
      allEvents.push({
        type: "view",
        timestamp: new Date(view.viewedAt),
        data: view,
      });
    }

    // Add download event (if exists)
    if (view.downloadedAt) {
      allEvents.push({
        type: "download",
        timestamp: new Date(view.downloadedAt),
        data: view,
      });
    }
  });

  // Sort chronologically (oldest to newest)
  allEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return (
    <>
      {allEvents.length > 0 ? (
        allEvents.map((event, index) => {
          if (event.type === "upload") {
            const upload = event.data;
            return (
              <TableRow key={`upload-${upload.documentId}-${index}`}>
                <TableCell>
                  <div className="flex items-center gap-x-4 overflow-visible">
                    <UploadCloudIcon className="h-5 w-5 text-[#fb7a00]" />
                    Uploaded {upload.originalFilename}
                  </div>
                </TableCell>
                <TableCell>
                  <TimestampTooltip
                    timestamp={event.timestamp}
                    side="right"
                    rows={["local", "utc", "unix"]}
                  >
                    <time
                      className="select-none truncate text-sm text-muted-foreground"
                      dateTime={event.timestamp.toISOString()}
                    >
                      {timeAgo(event.timestamp)}
                    </time>
                  </TimestampTooltip>
                </TableCell>
                <TableCell className="table-cell">
                  <div className="flex items-center justify-end space-x-4">
                    <Button size={"sm"} variant={"link"}>
                      <Link href={`/documents/${upload.documentId}`}>
                        See document
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          }

          if (event.type === "bulk-download") {
            const bulkGroup = event.data;
            const documentCount =
              bulkGroup.metadata?.documentCount || bulkGroup.documents.length;
            const hasDocumentList =
              bulkGroup.metadata?.documents &&
              bulkGroup.metadata.documents.length > 0;

            return (
              <TableRow key={`bulk-${index}`}>
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
                                        <span className="truncate">
                                          {doc.name}
                                        </span>
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
                      {bulkGroup.type === "FOLDER" &&
                      bulkGroup.metadata?.folderName ? (
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
                <TableCell>
                  <TimestampTooltip
                    timestamp={event.timestamp}
                    side="right"
                    rows={["local", "utc", "unix"]}
                  >
                    <time
                      className="select-none truncate text-sm text-muted-foreground"
                      dateTime={event.timestamp.toISOString()}
                    >
                      {timeAgo(event.timestamp)}
                    </time>
                  </TimestampTooltip>
                </TableCell>
                <TableCell className="table-cell"></TableCell>
              </TableRow>
            );
          }

          if (event.type === "view") {
            const view = event.data;
            return (
              <DocumentViewRow
                key={`view-${view.id}`}
                view={view}
                timestamp={event.timestamp}
                dataroomId={dataroomId}
              />
            );
          }

          if (event.type === "download") {
            const view = event.data;
            return (
              <TableRow key={`download-${view.id}`}>
                <TableCell>
                  <div className="flex items-center gap-x-4 overflow-visible">
                    <DownloadCloudIcon className="h-5 w-5 text-[#fb7a00]" />
                    Downloaded {view.document.name}
                  </div>
                </TableCell>
                <TableCell>
                  <TimestampTooltip
                    timestamp={event.timestamp}
                    side="right"
                    rows={["local", "utc", "unix"]}
                  >
                    <time
                      className="select-none truncate text-sm text-muted-foreground"
                      dateTime={event.timestamp.toISOString()}
                    >
                      {timeAgo(event.timestamp)}
                    </time>
                  </TimestampTooltip>
                </TableCell>
                <TableCell className="table-cell">
                  <div className="flex items-center justify-end space-x-4">
                    <Button size={"sm"} variant={"link"}>
                      <Link href={`/documents/${view.document.id}`}>
                        See document
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          }

          return null;
        })
      ) : documentViews === undefined ? (
        <TableRow>
          <TableCell>
            <Skeleton className="h-6 w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-6 w-16" />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

// Component for individual document view with collapsible page analytics
function DocumentViewRow({
  view,
  timestamp,
  dataroomId,
}: {
  view: {
    id: string;
    downloadType?: "SINGLE" | "BULK" | "FOLDER";
    downloadMetadata?: {
      folderName?: string;
      folderPath?: string;
      dataroomName?: string;
      documentCount?: number;
      documents?: { id: string; name: string }[];
    };
    document: {
      id: string;
      name: string;
    };
  };
  timestamp: Date;
  dataroomId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible asChild open={isOpen} onOpenChange={setIsOpen}>
      <>
        <TableRow className="group/view-row">
          <TableCell>
            <div className="flex items-center gap-x-4 overflow-visible">
              <FileCheckIcon className="h-5 w-5 text-[#fb7a00]" />
              Viewed {view.document.name}
            </div>
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
          <TableCell className="table-cell">
            <div className="flex items-center justify-end space-x-2">
              <CollapsibleTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1 text-xs"
                >
                  <span>Page analytics</span>
                  <ChevronDownIcon
                    className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      isOpen && "rotate-180",
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
          </TableCell>
        </TableRow>
        <CollapsibleContent asChild>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableCell colSpan={3} className="p-0">
              <DataroomDocumentViewChart
                dataroomId={dataroomId}
                documentId={view.document.id}
                viewId={view.id}
                downloadType={view.downloadType}
                downloadMetadata={view.downloadMetadata}
              />
            </TableCell>
          </TableRow>
        </CollapsibleContent>
      </>
    </Collapsible>
  );
}
