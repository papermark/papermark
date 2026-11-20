import { useRouter } from "next/router";

import {
  BadgeCheckIcon,
  BadgeInfoIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronsUpDownIcon,
  DownloadCloudIcon,
  FileBadgeIcon,
  FileSignatureIcon,
  GlobeIcon,
  UserRoundXIcon,
  UsersIcon,
} from "lucide-react";

import {
  AnonymousVisitorStats,
  DataroomVisitor,
} from "@/lib/swr/use-dataroom-visitors";
import { timeAgo } from "@/lib/utils";

import { Pagination } from "@/components/documents/pagination";
import { Button } from "@/components/ui/button";
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

import { VisitorAvatar } from "./visitor-avatar";
import { VisitorStatusBadge } from "./visitor-status-badge";

export function DataroomParticipantsTable({
  visitors,
  anonymous,
  pagination,
  sorting,
  isFiltered,
  onPageChange,
  onPageSizeChange,
  onSortChange,
}: {
  visitors: DataroomVisitor[] | null | undefined;
  anonymous?: AnonymousVisitorStats;
  pagination?: {
    currentPage: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  sorting?: {
    sortBy: string;
    sortOrder: string;
  };
  isFiltered?: boolean;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  onSortChange?: (sortBy: string, sortOrder: string) => void;
}) {
  const router = useRouter();

  const handleSort = (columnId: string) => {
    if (!onSortChange) return;

    if (sorting?.sortBy === columnId) {
      onSortChange(columnId, sorting.sortOrder === "asc" ? "desc" : "asc");
    } else {
      onSortChange(columnId, "desc");
    }
  };

  const getSortIcon = (columnId: string) => {
    if (sorting?.sortBy !== columnId) {
      return <ChevronsUpDownIcon className="ml-2 h-4 w-4" />;
    }
    return sorting.sortOrder === "asc" ? (
      <ChevronUpIcon className="ml-2 h-4 w-4" />
    ) : (
      <ChevronDownIcon className="ml-2 h-4 w-4" />
    );
  };

  const sortButton = (columnId: string, label: string) => (
    <Button
      variant="ghost"
      onClick={() => handleSort(columnId)}
      className={
        sorting?.sortBy === columnId
          ? "text-nowrap px-2 font-medium"
          : "text-nowrap px-2 font-normal"
      }
    >
      {label}
      {getSortIcon(columnId)}
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow className="*:whitespace-nowrap *:font-medium hover:bg-transparent">
              <TableHead>Participant</TableHead>
              <TableHead className="w-[170px]">Status</TableHead>
              <TableHead className="w-[130px]">
                {sortButton("totalVisits", "Visits")}
              </TableHead>
              <TableHead className="w-[150px]">
                {sortButton("lastViewed", "Last Viewed")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!visitors ? (
              [...Array(5)].map((_, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <div className="flex items-center space-x-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <Skeleton className="h-4 w-[200px]" />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-10" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-[100px]" />
                  </TableCell>
                </TableRow>
              ))
            ) : visitors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  {isFiltered
                    ? "No participants match your search."
                    : "No participants yet."}
                </TableCell>
              </TableRow>
            ) : (
              visitors.map((visitor) => {
                const rowKey = visitor.id ?? visitor.email;
                // Blocked people may still have visited before being blocked.
                const hasActivity =
                  visitor.totalVisits > 0 ||
                  visitor.documentViews > 0 ||
                  !!visitor.lastViewed;
                // Both dataroom groups (permissions) and team visitor groups.
                const groupNames = Array.from(
                  new Set(
                    visitor.accessSources
                      .filter(
                        (source) =>
                          source.type === "GROUP" ||
                          source.type === "VISITOR_GROUP",
                      )
                      .map((source) => source.name),
                  ),
                );
                return (
                  <TableRow
                    key={rowKey}
                    onClick={() =>
                      visitor.id && router.push(`/visitors/${visitor.id}`)
                    }
                    className={visitor.id ? "cursor-pointer" : undefined}
                  >
                    {/* Participant */}
                    <TableCell>
                      <div className="flex items-center overflow-visible sm:space-x-3">
                        {visitor.isDomain ? (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
                            <GlobeIcon className="h-4 w-4 text-muted-foreground" />
                          </div>
                        ) : (
                          <VisitorAvatar viewerEmail={visitor.email} />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-x-2 overflow-visible text-sm font-medium text-gray-800 dark:text-gray-200">
                            <span className="truncate">
                              {visitor.viewerName || visitor.email}
                            </span>
                            {visitor.verified && (
                              <BadgeTooltip
                                content="Verified email"
                                key={`verified-${rowKey}`}
                              >
                                <BadgeCheckIcon className="h-4 w-4 shrink-0 text-emerald-500 hover:text-emerald-600" />
                              </BadgeTooltip>
                            )}
                            {visitor.internal && (
                              <BadgeTooltip
                                content="Internal visitor"
                                key={`internal-${rowKey}`}
                              >
                                <BadgeInfoIcon className="h-4 w-4 shrink-0 text-blue-500 hover:text-blue-600" />
                              </BadgeTooltip>
                            )}
                            {visitor.agreement && (
                              <BadgeTooltip
                                content={
                                  visitor.agreement.signed
                                    ? `Signed ${visitor.agreement.name}`
                                    : `Agreed to ${visitor.agreement.name}`
                                }
                                key={`agreement-${rowKey}`}
                              >
                                {visitor.agreement.signed ? (
                                  <FileSignatureIcon className="h-4 w-4 shrink-0 text-emerald-500 hover:text-emerald-600" />
                                ) : (
                                  <FileBadgeIcon className="h-4 w-4 shrink-0 text-emerald-500 hover:text-emerald-600" />
                                )}
                              </BadgeTooltip>
                            )}
                            {visitor.downloads > 0 && (
                              <BadgeTooltip
                                content={`${visitor.downloads} download${visitor.downloads === 1 ? "" : "s"}`}
                                key={`downloads-${rowKey}`}
                              >
                                <DownloadCloudIcon className="h-4 w-4 shrink-0 text-cyan-500 hover:text-cyan-600" />
                              </BadgeTooltip>
                            )}
                            {groupNames.map((group) => (
                              <span
                                key={`${rowKey}-group-${group}`}
                                className="inline-flex max-w-[150px] shrink-0 items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-xs font-normal text-muted-foreground dark:border-gray-700"
                              >
                                <UsersIcon className="h-3 w-3 shrink-0" />
                                <span className="truncate">{group}</span>
                              </span>
                            ))}
                          </p>
                          {visitor.viewerName && visitor.email && (
                            <p className="truncate text-xs text-muted-foreground/60">
                              {visitor.email}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    {/* Status */}
                    <TableCell>
                      <VisitorStatusBadge
                        status={visitor.status}
                        invitedAt={visitor.invitedAt}
                        invitationStatus={visitor.invitationStatus}
                        accessSources={visitor.accessSources}
                        visitedLinks={
                          visitor.hasVisitedLinks ? visitor.linkNames : undefined
                        }
                      />
                    </TableCell>
                    {/* Visits */}
                    <TableCell className="text-sm text-muted-foreground">
                      {hasActivity ? (
                        <>
                          {visitor.totalVisits}
                          {visitor.documentViews > 0 ? (
                            <span className="ml-1 text-xs text-muted-foreground/60">
                              ({visitor.documentViews} doc
                              {visitor.documentViews === 1 ? "" : "s"})
                            </span>
                          ) : null}
                        </>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    {/* Last Viewed */}
                    <TableCell className="text-sm text-muted-foreground">
                      {visitor.lastViewed ? (
                        <TimestampTooltip
                          timestamp={visitor.lastViewed}
                          side="right"
                          rows={["local", "utc", "unix"]}
                        >
                          <time
                            className="select-none"
                            dateTime={new Date(visitor.lastViewed).toISOString()}
                          >
                            {timeAgo(visitor.lastViewed)}
                          </time>
                        </TimestampTooltip>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}

            {anonymous &&
            anonymous.visits > 0 &&
            !isFiltered &&
            (!pagination || !pagination.hasNext) ? (
              <TableRow className="bg-gray-50/60 hover:bg-gray-50/60 dark:bg-gray-900/40 dark:hover:bg-gray-900/40">
                <TableCell>
                  <div className="flex items-center overflow-visible sm:space-x-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-gray-300 dark:border-gray-700">
                      <UserRoundXIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                        Anonymous participants
                      </p>
                      <p className="text-xs text-muted-foreground/60">
                        Visits from links that do not ask for an email
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell />
                <TableCell className="text-sm text-muted-foreground">
                  {anonymous.visits}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {anonymous.lastViewed ? (
                    <TimestampTooltip
                      timestamp={anonymous.lastViewed}
                      side="right"
                      rows={["local", "utc", "unix"]}
                    >
                      <time
                        className="select-none"
                        dateTime={new Date(anonymous.lastViewed).toISOString()}
                      >
                        {timeAgo(anonymous.lastViewed)}
                      </time>
                    </TimestampTooltip>
                  ) : (
                    "-"
                  )}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.totalItems > 0 && (
        <Pagination
          currentPage={pagination.currentPage}
          pageSize={pagination.pageSize}
          totalItems={pagination.totalItems}
          totalPages={pagination.totalPages}
          onPageChange={(page) => onPageChange?.(page)}
          onPageSizeChange={(size) => onPageSizeChange?.(size)}
          totalShownItems={visitors?.length ?? 0}
          itemName="participants"
        />
      )}
    </div>
  );
}
