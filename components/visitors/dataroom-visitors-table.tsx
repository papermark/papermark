import Link from "next/link";

import { useState } from "react";

import { useTeam } from "@/context/team-context";
import {
  AlertTriangleIcon,
  BadgeCheckIcon,
  BadgeInfoIcon,
  Download,
  DownloadCloudIcon,
  FileBadgeIcon,
  MailOpenIcon,
} from "lucide-react";

import { usePlan } from "@/lib/swr/use-billing";
import { useDataroom } from "@/lib/swr/use-dataroom";
import { useDataroomVisits } from "@/lib/swr/use-dataroom";
import { timeAgo } from "@/lib/utils";

import ChevronDown from "@/components/shared/icons/chevron-down";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimestampTooltip } from "@/components/ui/timestamp-tooltip";
import { BadgeTooltip } from "@/components/ui/tooltip";

import { ExportVisitsModal } from "../datarooms/export-visits-modal";
import { DataroomViewStats } from "./dataroom-view-stats";
import DataroomVisitorCustomFields from "./dataroom-visitor-custom-fields";
import { DataroomVisitorUserAgent } from "./dataroom-visitor-useragent";
import { VisitorAvatar } from "./visitor-avatar";

export default function DataroomVisitorsTable({
  dataroomId,
  groupId,
  name,
}: {
  dataroomId: string;
  groupId?: string;
  name?: string;
}) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { views, hiddenFromPause } = useDataroomVisits({
    dataroomId,
    groupId,
  });
  const { dataroom } = useDataroom();
  const { isPaused } = usePlan();
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [expandedViewIds, setExpandedViewIds] = useState<Set<string>>(
    new Set(),
  );

  const exportVisitCounts = () => {
    setExportModalOpen(true);
  };

  const handleOpenChange = (viewId: string, open: boolean) => {
    setExpandedViewIds((prev) => {
      const next = new Set(prev);
      if (open) {
        next.add(viewId);
      } else {
        next.delete(viewId);
      }
      return next;
    });
  };

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between md:mb-4">
        <h2>All visitors</h2>
        <Button variant="outline" size="sm" onClick={exportVisitCounts}>
          <Download className="!size-4" />
          Export visits
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table className="min-w-[600px] table-fixed">
          <TableHeader>
            <TableRow className="*:whitespace-nowrap *:font-medium hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead className="w-[120px]">
                {expandedViewIds.size > 0 ? "View Duration" : null}
              </TableHead>
              <TableHead className="w-[140px]">
                {expandedViewIds.size > 0 ? "View Completion" : null}
              </TableHead>
              <TableHead className="w-[120px]">Last Viewed</TableHead>
              <TableHead className="w-[48px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {views?.length === 0 && hiddenFromPause === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="flex h-40 w-full items-center justify-center">
                    <p>No views yet. Try sharing a link.</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {isPaused && hiddenFromPause > 0 && (
              <>
                <TableRow>
                  <TableCell colSpan={5} className="text-left sm:text-center">
                    <div className="flex flex-col items-start justify-center gap-2 sm:flex-row sm:items-center">
                      <span className="flex items-center gap-x-1">
                        <AlertTriangleIcon className="inline-block h-4 w-4 text-orange-500" />
                        {hiddenFromPause} visit
                        {hiddenFromPause !== 1 ? "s" : ""} occurred after your
                        team was paused and{" "}
                        {hiddenFromPause !== 1 ? "are" : "is"} hidden.{" "}
                      </span>
                      <Link
                        href="/settings/billing"
                        className="font-medium text-orange-600 underline hover:text-orange-700"
                      >
                        Unpause subscription to see all visits
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
                {Array.from({ length: hiddenFromPause }).map((_, i) => (
                  <VisitorBlurred key={i} />
                ))}
              </>
            )}
            {views ? (
              views.map((view) => (
                <Collapsible
                  key={view.id}
                  asChild
                  onOpenChange={(open) => handleOpenChange(view.id, open)}
                >
                  <>
                    <TableRow key={view.id} className="group/row">
                      {/* Name */}
                      <TableCell className="">
                        <div className="flex items-center overflow-visible sm:space-x-3">
                          <VisitorAvatar viewerEmail={view.viewerEmail} />
                          <div className="min-w-0 flex-1">
                            <div className="focus:outline-none">
                              <p className="flex items-center gap-x-2 overflow-visible text-sm font-medium text-gray-800 dark:text-gray-200">
                                {view.viewerEmail ? (
                                  <>
                                    {view.viewerName || view.viewerEmail}{" "}
                                    {view.verified && (
                                      <BadgeTooltip
                                        content="Verified visitor"
                                        key={`verified-${view.id}`}
                                      >
                                        <BadgeCheckIcon className="h-4 w-4 text-emerald-500 hover:text-emerald-600" />
                                      </BadgeTooltip>
                                    )}
                                    {view.internal && (
                                      <BadgeTooltip
                                        content="Internal visitor"
                                        key={`internal-${view.id}`}
                                      >
                                        <BadgeInfoIcon className="h-4 w-4 text-blue-500 hover:text-blue-600" />
                                      </BadgeTooltip>
                                    )}
                                    {view.downloadedAt && (
                                      <BadgeTooltip
                                        content={`Downloaded ${timeAgo(view.downloadedAt)}`}
                                        key={`download-${view.id}`}
                                      >
                                        <DownloadCloudIcon className="h-4 w-4 text-cyan-500 hover:text-cyan-600" />
                                      </BadgeTooltip>
                                    )}
                                    {view.agreementResponse && (
                                      <BadgeTooltip
                                        content={`Agreed to ${view.agreementResponse.agreement.name}`}
                                        key={`agreement-${view.id}`}
                                      >
                                        <FileBadgeIcon className="h-4 w-4 text-emerald-500 hover:text-emerald-600" />
                                      </BadgeTooltip>
                                    )}
                                  </>
                                ) : (
                                  "Anonymous"
                                )}
                              </p>
                              {view.viewerName && view.viewerEmail && (
                                <p className="text-xs text-muted-foreground/60">
                                  {view.viewerEmail}
                                </p>
                              )}
                              <p className="text-xs text-muted-foreground/60 sm:text-sm">
                                {view.link.name ? view.link.name : view.linkId}
                              </p>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell />
                      <TableCell />
                      {/* Last Viewed */}
                      <TableCell className="text-sm text-muted-foreground">
                        <TimestampTooltip
                          timestamp={view.viewedAt}
                          side="right"
                          rows={["local", "utc", "unix"]}
                        >
                          <time
                            className="select-none"
                            dateTime={new Date(view.viewedAt).toISOString()}
                          >
                            {timeAgo(view.viewedAt)}
                          </time>
                        </TimestampTooltip>
                      </TableCell>
                      {/* Actions */}
                      <TableCell className="cursor-pointer p-0 text-center sm:text-right">
                        <CollapsibleTrigger asChild>
                          <div className="flex justify-end space-x-1 p-5 [&[data-state=open]>svg.chevron]:rotate-180">
                            <ChevronDown className="chevron h-4 w-4 shrink-0 transition-transform duration-200" />
                          </div>
                        </CollapsibleTrigger>
                      </TableCell>
                    </TableRow>

                    <CollapsibleContent asChild>
                      <>
                        <TableRow>
                          <TableCell colSpan={5}>
                            <DataroomVisitorCustomFields
                              viewId={view.id}
                              teamId={view.teamId!}
                              dataroomId={dataroomId}
                            />
                            <DataroomVisitorUserAgent viewId={view.id} />
                          </TableCell>
                        </TableRow>
                        <TableRow key={view.id} className="[&>td]:py-3">
                          <TableCell>
                            <div className="flex items-center gap-x-4 overflow-visible">
                              <MailOpenIcon className="h-5 w-5 text-[#fb7a00]" />
                              Accessed {view.dataroomName} dataroom
                            </div>
                          </TableCell>
                          <TableCell />
                          <TableCell />
                          <TableCell>
                            <TimestampTooltip
                              timestamp={view.viewedAt}
                              side="right"
                              rows={["local", "utc", "unix"]}
                            >
                              <time
                                className="select-none truncate text-sm text-muted-foreground"
                                dateTime={new Date(view.viewedAt).toISOString()}
                              >
                                {timeAgo(view.viewedAt)}
                              </time>
                            </TimestampTooltip>
                          </TableCell>
                          <TableCell />
                        </TableRow>

                        {view.downloadedAt ? (
                          <TableRow
                            key={`download-item-${view.id}`}
                            className="[&>td]:py-3"
                          >
                            <TableCell>
                              <div className="flex items-center gap-x-4 overflow-visible">
                                <DownloadCloudIcon className="h-5 w-5 text-cyan-500 hover:text-cyan-600" />
                                Downloaded {view.dataroomName} dataroom
                              </div>
                            </TableCell>
                            <TableCell />
                            <TableCell />
                            <TableCell>
                              <TimestampTooltip
                                timestamp={view.downloadedAt}
                                side="right"
                                rows={["local", "utc", "unix"]}
                              >
                                <time
                                  className="select-none truncate text-sm text-muted-foreground"
                                  dateTime={new Date(
                                    view.downloadedAt,
                                  ).toISOString()}
                                >
                                  {timeAgo(view.downloadedAt)}
                                </time>
                              </TimestampTooltip>
                            </TableCell>
                            <TableCell />
                          </TableRow>
                        ) : null}

                        <DataroomViewStats
                          viewId={view.id}
                          dataroomId={dataroomId}
                          isExpanded={expandedViewIds.has(view.id)}
                        />
                      </>
                    </CollapsibleContent>
                  </>
                </Collapsible>
              ))
            ) : (
              <TableRow>
                <TableCell className="min-w-[100px]">
                  <Skeleton className="h-6 w-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-6 w-14" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-6 w-6 rounded-full" />
                </TableCell>
                <TableCell className="min-w-[100px]">
                  <Skeleton className="h-6 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-6 w-6" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {dataroom && teamId && exportModalOpen && (
        <ExportVisitsModal
          dataroomId={dataroomId}
          dataroomName={dataroom.name}
          teamId={teamId}
          groupId={groupId}
          groupName={name}
          onClose={() => setExportModalOpen(false)}
        />
      )}
    </div>
  );
}

const VisitorBlurred = () => {
  return (
    <TableRow className="blur-sm">
      <TableCell className="">
        <div className="flex items-center overflow-visible sm:space-x-3">
          <VisitorAvatar viewerEmail={"abc@example.org"} />
          <div className="min-w-0 flex-1">
            <div className="focus:outline-none">
              <p className="flex items-center gap-x-2 overflow-visible text-sm font-medium text-gray-800 dark:text-gray-200">
                Anonymous
              </p>
              <p className="text-xs text-muted-foreground/60 sm:text-sm">
                Demo link
              </p>
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell />
      <TableCell />
      {/* Last Viewed */}
      <TableCell className="text-sm text-muted-foreground">
        <time
          dateTime={new Date(
            new Date().getTime() - 30 * 24 * 60 * 60 * 1000,
          ).toISOString()}
        >
          {timeAgo(new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000))}
        </time>
      </TableCell>
      {/* Actions */}
      <TableCell className="cursor-pointer p-0 text-center sm:text-right">
        <div className="flex justify-end space-x-1 p-5 [&[data-state=open]>svg.chevron]:rotate-180">
          <ChevronDown className="chevron h-4 w-4 shrink-0 transition-transform duration-200" />
        </div>
      </TableCell>
    </TableRow>
  );
};
