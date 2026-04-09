import { useCallback, useMemo, useState } from "react";
import { Dispatch, SetStateAction } from "react";

import { useTeam } from "@/context/team-context";
import { ItemType } from "@prisma/client";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  File,
  Folder,
} from "lucide-react";

import { useDataroomFoldersTree } from "@/lib/swr/use-dataroom";
import { useDataroomStats } from "@/lib/swr/use-dataroom-stats";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { DocumentViewPreviewModal } from "./document-view-preview-modal";

// Define types for the file/folder structure with analytics
type FileOrFolder = {
  id: string;
  name: string;
  subItems?: FileOrFolder[];
  analytics: {
    views: number;
    downloads: number;
  };
  itemType: ItemType;
  documentId?: string;
};

interface DocumentAnalyticsTreeProps {
  dataroomId: string;
  selectedDocument: {
    id: string;
    name: string;
  } | null;
  setSelectedDocument: Dispatch<
    SetStateAction<{
      id: string;
      name: string;
    } | null>
  >;
}

export default function DocumentAnalyticsTree({
  dataroomId,
  selectedDocument,
  setSelectedDocument,
}: DocumentAnalyticsTreeProps) {
  const { folders, loading: foldersLoading } = useDataroomFoldersTree({
    dataroomId,
    include_documents: true,
  });
  const { stats: dataroomStats, loading: statsLoading } = useDataroomStats();

  // State for view preview modal
  const [viewPreviewDocument, setViewPreviewDocument] = useState<{
    id: string;
    documentId: string;
    name: string;
    views: number;
    downloads: number;
  } | null>(null);

  // Memoize the tree data building
  const data = useMemo(() => {
    if (!folders || foldersLoading || !dataroomStats || statsLoading) {
      return [];
    }

    return buildTree(folders, dataroomStats);
  }, [folders, foldersLoading, dataroomStats, statsLoading]);

  const handleRowClick = useCallback(
    (row: FileOrFolder) => {
      // Only select documents, not folders
      if (row.itemType === ItemType.DATAROOM_DOCUMENT && row.documentId) {
        if (selectedDocument && selectedDocument.id === row.documentId) {
          // If clicking on the already selected document, deselect it
          setSelectedDocument(null);
        } else {
          // Otherwise select the clicked document
          setSelectedDocument({
            id: row.documentId,
            name: row.name,
          });
        }
      }
    },
    [selectedDocument, setSelectedDocument],
  );

  const handleViewsClick = useCallback(
    (row: FileOrFolder, e: React.MouseEvent) => {
      e.stopPropagation();
      // Only open modal for documents with views
      if (
        row.itemType === ItemType.DATAROOM_DOCUMENT &&
        row.documentId &&
        row.analytics.views > 0
      ) {
        setViewPreviewDocument({
          id: row.id,
          documentId: row.documentId,
          name: row.name,
          views: row.analytics.views,
          downloads: row.analytics.downloads,
        });
      }
    },
    [],
  );

  const createColumns = useCallback(
    (): ColumnDef<FileOrFolder>[] => [
      {
        id: "expander",
        header: () => null,
        cell: ({ row }) => {
          return row.getCanExpand() ? (
            <Button
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                row.getToggleExpandedHandler()();
              }}
              className="h-6 w-6 p-0"
            >
              {row.getIsExpanded() ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          ) : null;
        },
      },
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="flex items-center text-foreground">
            {row.original.itemType === ItemType.DATAROOM_FOLDER ? (
              <Folder className="mr-2 h-5 w-5" />
            ) : (
              <File className="mr-2 h-5 w-5" />
            )}
            <span className="truncate">{row.original.name}</span>
          </div>
        ),
      },
      {
        id: "views",
        header: () => (
          <div className="flex items-center justify-center">
            <Eye className="mr-1 h-4 w-4" />
            <span>Views</span>
          </div>
        ),
        cell: ({ row }) => {
          const isDocument =
            row.original.itemType === ItemType.DATAROOM_DOCUMENT;
          const hasViews = row.original.analytics.views > 0;
          const isClickable = isDocument && hasViews;

          return (
            <div
              className={cn(
                "text-center",
                isClickable &&
                  "cursor-pointer rounded px-2 py-1 font-medium text-primary underline-offset-2 transition-colors hover:bg-primary/10 hover:underline",
              )}
              onClick={
                isClickable
                  ? (e) => handleViewsClick(row.original, e)
                  : undefined
              }
              title={isClickable ? "Click to see visitor details" : undefined}
            >
              {row.original.analytics.views}
            </div>
          );
        },
      },
      {
        id: "downloads",
        header: () => (
          <div className="flex items-center justify-center">
            <Download className="mr-1 h-4 w-4" />
            <span>Downloads</span>
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-center">{row.original.analytics.downloads}</div>
        ),
      },
    ],
    [handleViewsClick],
  );

  const columns = useMemo(() => createColumns(), [createColumns]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getSubRows: (row) => row.subItems,
  });

  if (foldersLoading || statsLoading) {
    return <div>Loading analytics data...</div>;
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="py-2 first:w-12">
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
                  data-state={row.getIsSelected() && "selected"}
                  className={cn(
                    "cursor-pointer hover:bg-muted/50",
                    // Highlight the selected document
                    selectedDocument &&
                      row.original.documentId === selectedDocument.id &&
                      "bg-muted",
                  )}
                  onClick={() => handleRowClick(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      style={{
                        paddingLeft:
                          cell.column.id === "name"
                            ? `${row.depth * 1.25 + 1}rem`
                            : undefined,
                      }}
                      className="py-2"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No analytics data available.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* View Preview Modal */}
      {viewPreviewDocument && (
        <DocumentViewPreviewModal
          isOpen={!!viewPreviewDocument}
          onClose={() => setViewPreviewDocument(null)}
          dataroomId={dataroomId}
          document={viewPreviewDocument}
        />
      )}
    </>
  );
}

// Build the tree structure with analytics data
const buildTree = (
  items: any[],
  statsData: any,
  parentId: string | null = null,
): FileOrFolder[] => {
  const getAnalytics = (id: string, documentId?: string) => {
    // Count views for this specific item
    const views =
      statsData?.documentViews.filter(
        (view: any) => view.itemId === id || view.documentId === documentId,
      ).length || 0;

    // Count downloads for this specific item (assuming downloads are tracked in views with a downloadedAt field)
    const downloads =
      statsData?.documentViews.filter(
        (view: any) =>
          (view.itemId === id || view.documentId === documentId) &&
          view.downloadedAt,
      ).length || 0;

    return {
      views,
      downloads,
    };
  };

  const result: FileOrFolder[] = [];

  // Handle folders and their contents
  items
    .filter((item) => item.parentId === parentId && !item.document)
    .forEach((folder) => {
      const subItems = buildTree(items, statsData, folder.id);

      // Add documents directly in this folder
      const folderDocuments = (folder.documents || []).map((doc: any) => {
        const analytics = getAnalytics(doc.id, doc.document.id);
        return {
          id: doc.id,
          documentId: doc.document.id,
          name: doc.document.name,
          analytics,
          itemType: ItemType.DATAROOM_DOCUMENT,
        };
      });

      const allSubItems = [...subItems, ...folderDocuments];

      // Calculate aggregated analytics for the folder
      const folderAnalytics = {
        views: allSubItems.reduce((sum, item) => sum + item.analytics.views, 0),
        downloads: allSubItems.reduce(
          (sum, item) => sum + item.analytics.downloads,
          0,
        ),
      };

      result.push({
        id: folder.id,
        name: folder.name,
        subItems: allSubItems,
        analytics: folderAnalytics,
        itemType: ItemType.DATAROOM_FOLDER,
      });
    });

  // Handle documents at the current level
  items
    .filter(
      (item) =>
        (item.parentId === parentId && item.document) ||
        (parentId === null && item.folderId === null && item.document),
    )
    .forEach((doc) => {
      const analytics = getAnalytics(doc.id, doc.document.id);
      result.push({
        id: doc.id,
        documentId: doc.document.id,
        name: doc.document.name,
        analytics,
        itemType: ItemType.DATAROOM_DOCUMENT,
      });
    });

  return result;
};
