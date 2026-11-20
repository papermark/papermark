import { useRouter } from "next/router";

import { useCallback, useMemo } from "react";
import React from "react";

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  BadgeCheckIcon,
  BadgeInfoIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronsUpDownIcon,
  FileBadgeIcon,
  FileSignatureIcon,
  GlobeIcon,
  UserRoundXIcon,
} from "lucide-react";

import { timeAgo } from "@/lib/utils";

import { Pagination } from "@/components/documents/pagination";
import { Button } from "@/components/ui/button";
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
import { VisitorAvatar } from "@/components/visitors/visitor-avatar";
import {
  VisitorAccessSource,
  VisitorStatus,
  VisitorStatusBadge,
} from "@/components/visitors/visitor-status-badge";

import { Skeleton } from "../ui/skeleton";

type Viewer = {
  id: string | null;
  email: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  totalVisits: number;
  lastViewed: Date | null;
  viewerName?: string | null;
  isDomain?: boolean;
  verified?: boolean;
  internal?: boolean;
  agreement?: { name: string; signed: boolean } | null;
  status?: VisitorStatus;
  invitedAt?: Date | null;
  invitationStatus?: string | null;
  accessSources?: VisitorAccessSource[];
};

export function ContactsTable({
  viewers,
  anonymous,
  pagination,
  sorting,
  isFiltered,
  onPageChange,
  onPageSizeChange,
  onSortChange,
}: {
  viewers: Viewer[] | null | undefined;
  anonymous?: { visits: number; lastViewed: Date | null };
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

  const data = useMemo(() => viewers || [], [viewers]);

  const handlePageChange = (page: number) => {
    if (onPageChange) {
      onPageChange(page);
    }
  };

  const handlePageSizeChange = (size: number) => {
    if (onPageSizeChange) {
      onPageSizeChange(size);
    }
  };

  const handleSort = useCallback(
    (columnId: string) => {
      if (!onSortChange) return;

      const currentSortBy = sorting?.sortBy;
      const currentSortOrder = sorting?.sortOrder;

      if (currentSortBy === columnId) {
        if (columnId === "lastViewed") {
          if (currentSortOrder === "asc") {
            onSortChange("lastViewed", "desc");
          } else {
            onSortChange("lastViewed", "asc");
          }
        } else {
          if (currentSortOrder === "asc") {
            onSortChange(columnId, "desc");
          } else if (currentSortOrder === "desc") {
            onSortChange("lastViewed", "desc");
          }
        }
      } else {
        onSortChange(columnId, "asc");
      }
    },
    [onSortChange, sorting?.sortBy, sorting?.sortOrder],
  );

  const getSortIcon = useCallback(
    (columnId: string) => {
      const currentSortBy = sorting?.sortBy;
      const currentSortOrder = sorting?.sortOrder;

      if (currentSortBy !== columnId) {
        return <ChevronsUpDownIcon className="ml-2 h-4 w-4" />;
      }

      return currentSortOrder === "asc" ? (
        <ChevronUpIcon className="ml-2 h-4 w-4" />
      ) : (
        <ChevronDownIcon className="ml-2 h-4 w-4" />
      );
    },
    [sorting?.sortBy, sorting?.sortOrder],
  );

  const getSortClass = useCallback(
    (columnId: string) => {
      const currentSortBy = sorting?.sortBy;
      return currentSortBy === columnId
        ? "text-nowrap font-medium"
        : "text-nowrap font-normal";
    },
    [sorting?.sortBy],
  );

  const columns: ColumnDef<Viewer>[] = useMemo(
    () => [
      {
        accessorKey: "email",
        header: "Contact",
        cell: ({ row }) => (
          <div className="flex items-center overflow-visible sm:space-x-3">
            {row.original.isDomain ? (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
                <GlobeIcon className="h-4 w-4 text-muted-foreground" />
              </div>
            ) : (
              <VisitorAvatar viewerEmail={row.original.email} />
            )}
            <div className="min-w-0 flex-1">
              <div className="focus:outline-none">
                <p className="flex items-center gap-x-2 overflow-visible text-sm font-medium text-gray-800 dark:text-gray-200">
                  <span className="truncate">
                    {row.original.viewerName || row.original.email}
                  </span>
                  {row.original.verified && (
                    <BadgeTooltip
                      content="Verified email"
                      key={`verified-${row.original.email}`}
                    >
                      <BadgeCheckIcon className="h-4 w-4 shrink-0 text-emerald-500 hover:text-emerald-600" />
                    </BadgeTooltip>
                  )}
                  {row.original.internal && (
                    <BadgeTooltip
                      content="Internal visitor"
                      key={`internal-${row.original.email}`}
                    >
                      <BadgeInfoIcon className="h-4 w-4 shrink-0 text-blue-500 hover:text-blue-600" />
                    </BadgeTooltip>
                  )}
                  {row.original.agreement && (
                    <BadgeTooltip
                      content={
                        row.original.agreement.signed
                          ? `Signed ${row.original.agreement.name}`
                          : `Agreed to ${row.original.agreement.name}`
                      }
                      key={`agreement-${row.original.email}`}
                    >
                      {row.original.agreement.signed ? (
                        <FileSignatureIcon className="h-4 w-4 shrink-0 text-emerald-500 hover:text-emerald-600" />
                      ) : (
                        <FileBadgeIcon className="h-4 w-4 shrink-0 text-emerald-500 hover:text-emerald-600" />
                      )}
                    </BadgeTooltip>
                  )}
                </p>
                {row.original.viewerName && row.original.email && (
                  <p className="text-xs text-muted-foreground/60">
                    {row.original.email}
                  </p>
                )}
              </div>
            </div>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) =>
          row.original.status ? (
            <VisitorStatusBadge
              status={row.original.status}
              invitedAt={row.original.invitedAt}
              invitationStatus={row.original.invitationStatus}
              accessSources={row.original.accessSources}
            />
          ) : null,
      },
      {
        accessorKey: "lastViewed",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => handleSort("lastViewed")}
              className={getSortClass("lastViewed")}
            >
              Last Viewed
              {getSortIcon("lastViewed")}
            </Button>
          );
        },
        cell: ({ row }) => {
          const lastView = row.original.lastViewed;
          return lastView ? (
            <TimestampTooltip
              timestamp={lastView}
              side="right"
              rows={["local", "utc", "unix"]}
            >
              <time
                className="select-none text-sm text-muted-foreground"
                dateTime={new Date(lastView).toISOString()}
              >
                {timeAgo(lastView)}
              </time>
            </TimestampTooltip>
          ) : (
            <div className="text-sm text-muted-foreground">-</div>
          );
        },
      },
      {
        accessorKey: "totalVisits",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => handleSort("totalVisits")}
              className={getSortClass("totalVisits")}
            >
              Total Views
              {getSortIcon("totalVisits")}
            </Button>
          );
        },
        cell: ({ row }) => (
          <div className="text-sm text-muted-foreground">
            {row.original.totalVisits > 0 || row.original.lastViewed
              ? row.original.totalVisits
              : "-"}
          </div>
        ),
      },
    ],
    [handleSort, getSortIcon, getSortClass],
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });

  if (!viewers) {
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Viewed</TableHead>
              <TableHead>Total Views</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...Array(5)].map((_, index) => (
              <TableRow key={index}>
                <TableCell>
                  <div className="flex items-center space-x-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <Skeleton className="h-4 w-[200px]" />
                  </div>
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-[80px]" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-[100px]" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-[50px]" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  const handleRowClick = (id: string | null) => {
    // Allow-list entries and domains have no viewer profile to open.
    if (!id) return;
    router.push(`/visitors/${id}`);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="px-0 first:px-4">
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => handleRowClick(row.original.id)}
                  className={row.original.id ? "cursor-pointer" : undefined}
                >
                  {row.getVisibleCells().map((cell) => {
                    return (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No visitors yet.
                </TableCell>
              </TableRow>
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
                        Anonymous visitors
                      </p>
                      <p className="text-xs text-muted-foreground/60">
                        Visits from links that do not ask for an email
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell />
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
                <TableCell className="text-sm text-muted-foreground">
                  {anonymous.visits}
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
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          totalShownItems={data.length}
          itemName="visitors"
        />
      )}
    </div>
  );
}
