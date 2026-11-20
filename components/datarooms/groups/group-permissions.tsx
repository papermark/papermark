"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import { ItemType, ViewerGroupAccessControls } from "@prisma/client";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDownToLineIcon,
  ChevronDown,
  ChevronRight,
  EyeIcon,
  EyeOffIcon,
  File,
  Folder,
  HomeIcon,
  Loader2Icon,
} from "lucide-react";
import { toast } from "sonner";

import {
  VIRTUAL_ROOT_ID,
  aggregateFolderPermissions,
  collectChangesForItem,
  collectChangesForRoot,
  findItemAndParents,
  resolveToggleIntent,
  type PermissionChanges,
} from "@/lib/dataroom/permissions-tree";
import { useDataroomFoldersTree } from "@/lib/swr/use-dataroom";
import { cn } from "@/lib/utils";
import {
  HIERARCHICAL_DISPLAY_STYLE,
  getHierarchicalDisplayName,
  useDataroomIndexDisplayEnabled,
} from "@/lib/utils/hierarchical-display";

import CloudDownloadOff from "@/components/shared/icons/cloud-download-off";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const PermissionItemName = ({ item }: { item: FileOrFolder }) => {
  const isDataroomIndexEnabled = useDataroomIndexDisplayEnabled();

  const displayName = getHierarchicalDisplayName(
    item.name,
    item.hierarchicalIndex,
    isDataroomIndexEnabled,
  );

  const isRoot = item.id === VIRTUAL_ROOT_ID;

  return (
    <div className="flex min-w-0 items-center text-foreground">
      {isRoot ? (
        <HomeIcon className="mr-2 h-5 w-5 shrink-0" />
      ) : item.itemType === ItemType.DATAROOM_FOLDER ? (
        <Folder className="mr-2 h-5 w-5 shrink-0" />
      ) : (
        <File className="mr-2 h-5 w-5 shrink-0" />
      )}
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <span
            className="truncate"
            style={HIERARCHICAL_DISPLAY_STYLE}
          >
            {displayName}
          </span>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent className="max-w-sm break-words" side="top">
            {displayName}
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </div>
  );
};

// Update the FileOrFolder type to include permissions
type FileOrFolder = {
  id: string;
  name: string;
  hierarchicalIndex?: string | null;
  subItems?: FileOrFolder[];
  permissions: {
    view: boolean;
    download: boolean;
    partialView?: boolean;
    partialDownload?: boolean;
  };
  itemType: ItemType;
  documentId?: string;
};

type ItemPermission = PermissionChanges;

type ColumnExtra = {
  updatePermissions: (id: string, newPermissions: string[]) => void;
};

const createColumns = (extra: ColumnExtra): ColumnDef<FileOrFolder>[] => [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => {
      const isRoot = row.original.id === VIRTUAL_ROOT_ID;
      return (
        <div className="flex min-w-0 items-center text-foreground">
          {isRoot ? (
            <div className="h-6 w-6 shrink-0" />
          ) : row.getCanExpand() ? (
            <Button
              variant="ghost"
              onClick={row.getToggleExpandedHandler()}
              className="mr-1 h-6 w-6 shrink-0 p-0"
              disabled={isRoot}
            >
              {row.getIsExpanded() ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          ) : (
            <div className="mr-1 h-6 w-6 shrink-0" />
          )}
          <PermissionItemName item={row.original} />
        </div>
      );
    },
  },
  {
    id: "actions",
    header: "Actions",
    cell: ({ row }) => {
      const item = row.original;

      const handleValueChange = (value: string[]) => {
        extra.updatePermissions(item.id, value);
      };

      const toggleValue: string[] = [];
      if (item.permissions.view) toggleValue.push("view");
      if (item.permissions.download) toggleValue.push("download");

      return (
        <ToggleGroup
          type="multiple"
          value={toggleValue}
          onValueChange={handleValueChange}
        >
          <ToggleGroupItem
            value="view"
            aria-label="Toggle view"
            size="sm"
            className={cn(
              "px-2 text-muted-foreground hover:ring-1 hover:ring-gray-400 data-[state=on]:bg-foreground data-[state=on]:text-background",
              item.permissions.view
                ? item.permissions.partialView
                  ? "data-[state=on]:bg-gray-400 data-[state=on]:text-background"
                  : "data-[state=on]:bg-foreground data-[state=on]:text-background"
                : "",
            )}
          >
            {item.permissions.view ||
            (item.permissions.view && item.permissions.partialView) ? (
              <EyeIcon className="h-5 w-5" />
            ) : (
              <EyeOffIcon className="h-5 w-5" />
            )}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="download"
            aria-label="Toggle download"
            size="sm"
            className={cn(
              "px-2 text-muted-foreground hover:ring-1 hover:ring-gray-400 data-[state=on]:bg-foreground data-[state=on]:text-background",
              item.permissions.download
                ? item.permissions.partialDownload
                  ? "data-[state=on]:bg-gray-400 data-[state=on]:text-background"
                  : "data-[state=on]:bg-foreground data-[state=on]:text-background"
                : "",
            )}
          >
            {item.permissions.download ||
            (item.permissions.download && item.permissions.partialDownload) ? (
              <ArrowDownToLineIcon className="h-5 w-5" />
            ) : (
              <CloudDownloadOff className="h-5 w-5" />
            )}
          </ToggleGroupItem>
        </ToggleGroup>
      );
    },
  },
];

// Build tree function to include permissions
const buildTree = (
  items: any[],
  permissions: ViewerGroupAccessControls[],
  parentId: string | null = null,
): FileOrFolder[] => {
  const getPermissions = (id: string) => {
    const permission = permissions.find((p) => p.itemId === id);

    // No row in viewerGroupAccessControls means the viewer cannot see the
    // item. Default to false so the UI faithfully reflects the persisted
    // server state (otherwise toggling one item silently changes the view of
    // unrelated items after refetch, which feels random to users).
    return {
      view: permission ? permission.canView : false,
      download: permission ? permission.canDownload : false,
      partialView: false,
      partialDownload: false,
    };
  };

  const result: FileOrFolder[] = [];

  // Handle folders and their contents
  items
    .filter((item) => item.parentId === parentId && !item.document)
    .forEach((folder) => {
      const subItems = buildTree(items, permissions, folder.id);

      // Add documents directly in this folder
      const folderDocuments = (folder.documents || []).map((doc: any) => ({
        id: doc.id,
        documentId: doc.document.id,
        name: doc.document.name,
        hierarchicalIndex: doc.hierarchicalIndex,
        permissions: getPermissions(doc.id),
        itemType: ItemType.DATAROOM_DOCUMENT,
      }));

      const allSubItems = [...subItems, ...folderDocuments];

      const folderPermissions = getPermissions(folder.id);

      // Aggregate from direct children so the partial (indeterminate) state
      // propagates up the tree — a folder whose only-hidden descendant is
      // several levels deep must still render as partial. Empty folders fall
      // back to their own persisted permission row.
      const aggregated = aggregateFolderPermissions(
        allSubItems.map((sub) => sub.permissions),
      ) ?? {
        view: folderPermissions.view,
        download: folderPermissions.download,
        partialView: false,
        partialDownload: false,
      };

      result.push({
        id: folder.id,
        name: folder.name,
        hierarchicalIndex: folder.hierarchicalIndex,
        subItems: allSubItems,
        permissions: aggregated,
        itemType: ItemType.DATAROOM_FOLDER,
      });
    });

  // Handle documents at the current level (including root level)
  items
    .filter(
      (item) =>
        (item.parentId === parentId && item.document) ||
        (parentId === null && item.folderId === null && item.document),
    )
    .forEach((doc) => {
      result.push({
        id: doc.id,
        documentId: doc.document.id,
        name: doc.document.name,
        hierarchicalIndex: doc.hierarchicalIndex,
        permissions: getPermissions(doc.id),
        itemType: ItemType.DATAROOM_DOCUMENT,
      });
    });

  return result;
};

// Build tree with virtual root folder
const buildTreeWithRoot = (
  items: any[],
  permissions: ViewerGroupAccessControls[],
  dataroomName: string = "Home",
): FileOrFolder[] => {
  // Get all items (folders and root documents)
  const allItems = buildTree(items, permissions, null);

  // Calculate overall permissions for the virtual root
  const calculateRootPermissions = (items: FileOrFolder[]) => {
    const flattenItems = (items: FileOrFolder[]): FileOrFolder[] => {
      return items.reduce((acc, item) => {
        acc.push(item);
        if (item.subItems) {
          acc.push(...flattenItems(item.subItems));
        }
        return acc;
      }, [] as FileOrFolder[]);
    };

    const allFlatItems = flattenItems(items);
    const viewableItems = allFlatItems.filter((item) => item.permissions.view);
    const downloadableItems = allFlatItems.filter(
      (item) => item.permissions.download,
    );

    return {
      view: viewableItems.length > 0,
      download: downloadableItems.length > 0,
      partialView:
        viewableItems.length > 0 && viewableItems.length < allFlatItems.length,
      partialDownload:
        downloadableItems.length > 0 &&
        downloadableItems.length < allFlatItems.length,
    };
  };

  const rootPermissions = calculateRootPermissions(allItems);

  return [
    {
      id: VIRTUAL_ROOT_ID,
      name: dataroomName,
      subItems: allItems,
      permissions: rootPermissions,
      itemType: ItemType.DATAROOM_FOLDER,
    },
  ];
};

export default function ExpandableTable({
  dataroomId,
  groupId,
  permissions,
  onSaved,
}: {
  dataroomId: string;
  groupId: string;
  permissions: ViewerGroupAccessControls[];
  onSaved?: () => void | Promise<unknown>;
}) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { folders, loading } = useDataroomFoldersTree({
    dataroomId,
    include_documents: true,
  });
  const [data, setData] = useState<FileOrFolder[]>([]);
  const [pendingChanges, setPendingChanges] = useState<ItemPermission>({});
  const [isSaving, setIsSaving] = useState(false);
  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  // Use ref to access current data without dependency
  const dataRef = useRef<FileOrFolder[]>([]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const updatePermissions = useCallback(
    (id: string, newPermissions: string[]) => {
      const isRoot = id === VIRTUAL_ROOT_ID;

      const rawPermissions = {
        view: newPermissions.includes("view"),
        download: newPermissions.includes("download"),
      };

      // Resolve user intent against the previous state so clicking the
      // download icon on a not-yet-visible item also flips view on (instead
      // of being silently dropped by the "download requires view" rule).
      let foundResult: ReturnType<typeof findItemAndParents> = null;
      let previous: { view: boolean; download: boolean };
      if (isRoot) {
        const root = dataRef.current[0];
        if (!root) return;
        previous = {
          view: root.permissions.view,
          download: root.permissions.download,
        };
      } else {
        foundResult = findItemAndParents(dataRef.current, id);
        if (!foundResult) return;
        previous = {
          view: foundResult.item.permissions.view,
          download: foundResult.item.permissions.download,
        };
      }
      const resolved = resolveToggleIntent(previous, rawPermissions);
      const normalized = resolved.view
        ? resolved
        : { view: false, download: false };

      if (isRoot) {
        setData((prevData) => {
          const updateAllItems = (items: FileOrFolder[]): FileOrFolder[] => {
            return items.map((currentItem) => ({
              ...currentItem,
              permissions: {
                view: normalized.view,
                download: normalized.download,
                partialView: false,
                partialDownload: false,
              },
              subItems: currentItem.subItems
                ? updateAllItems(currentItem.subItems)
                : undefined,
            }));
          };

          return updateAllItems(prevData);
        });

        const rootChanges = collectChangesForRoot(dataRef.current, normalized);
        setPendingChanges((prev) => ({ ...prev, ...rootChanges }));
        return;
      }

      const { item, parents } = foundResult!;

      setData((prevData) => {
        const updateSubItems = (
          items: FileOrFolder[],
          viewState: boolean,
          downloadState: boolean,
        ): FileOrFolder[] => {
          return items.map((subItem) => ({
            ...subItem,
            permissions: {
              ...subItem.permissions,
              view: viewState,
              partialView: false,
              partialDownload: false,
              download: downloadState,
            },
            subItems: subItem.subItems
              ? updateSubItems(subItem.subItems, viewState, downloadState)
              : undefined,
          }));
        };

        const recalculateParentPermissions = (
          parent: FileOrFolder,
          subItems: FileOrFolder[],
        ): FileOrFolder => {
          const isParentRoot = parent.id === VIRTUAL_ROOT_ID;

          if (isParentRoot) {
            const flattenItems = (items: FileOrFolder[]): FileOrFolder[] =>
              items.reduce((acc, current) => {
                if (current.id !== VIRTUAL_ROOT_ID) acc.push(current);
                if (current.subItems) acc.push(...flattenItems(current.subItems));
                return acc;
              }, [] as FileOrFolder[]);

            const allItems = flattenItems(subItems);
            const viewableItems = allItems.filter((i) => i.permissions.view);
            const downloadableItems = allItems.filter(
              (i) => i.permissions.download,
            );
            return {
              ...parent,
              permissions: {
                view: viewableItems.length > 0,
                partialView:
                  viewableItems.length > 0 &&
                  viewableItems.length < allItems.length,
                download: downloadableItems.length > 0,
                partialDownload:
                  downloadableItems.length > 0 &&
                  downloadableItems.length < allItems.length,
              },
              subItems,
            };
          }

          // Same aggregation rule as `buildTree` — propagate `partialView`
          // and `partialDownload` so an ancestor stays partial when any
          // descendant (not just an immediate child) is hidden.
          const aggregated = aggregateFolderPermissions(
            subItems.map((sub) => sub.permissions),
          ) ?? {
            view: parent.permissions.view,
            download: parent.permissions.download,
            partialView: false,
            partialDownload: false,
          };

          return {
            ...parent,
            permissions: aggregated,
            subItems,
          };
        };

        const updateItemInTree = (items: FileOrFolder[]): FileOrFolder[] => {
          return items.map((currentItem) => {
            if (currentItem.id === id) {
              const updatedItem = {
                ...currentItem,
                permissions: {
                  view: normalized.view,
                  download: normalized.download,
                  partialView: false,
                  partialDownload: false,
                },
              };

              if (updatedItem.itemType === ItemType.DATAROOM_FOLDER) {
                updatedItem.subItems = updateSubItems(
                  updatedItem.subItems || [],
                  normalized.view,
                  normalized.download,
                );
              }

              return updatedItem;
            }

            if (parents.some((parent) => parent.id === currentItem.id)) {
              const updatedSubItems = currentItem.subItems
                ? updateItemInTree(currentItem.subItems)
                : [];
              return recalculateParentPermissions(currentItem, updatedSubItems);
            }

            if (currentItem.subItems) {
              return {
                ...currentItem,
                subItems: updateItemInTree(currentItem.subItems),
              };
            }
            return currentItem;
          });
        };

        return updateItemInTree(prevData);
      });

      const changes = collectChangesForItem(item, parents, normalized);
      setPendingChanges((prev) => ({ ...prev, ...changes }));
    },
    [],
  );

  // Rebuild the tree from server state when the underlying permissions or
  // folder tree change. We intentionally only do this when there are no
  // pending edits so that an in-flight SWR refetch (e.g. from another tab)
  // never wipes out unsaved work in this view.
  useEffect(() => {
    if (folders && !loading && !hasPendingChanges) {
      const treeData = buildTreeWithRoot(folders, permissions, "Home");
      setData(treeData);
    }
  }, [folders, loading, permissions, hasPendingChanges]);

  const handleDiscardChanges = useCallback(() => {
    if (!folders) return;
    setPendingChanges({});
    setData(buildTreeWithRoot(folders, permissions, "Home"));
  }, [folders, permissions]);

  const handleSaveChanges = useCallback(async () => {
    if (!hasPendingChanges || isSaving) return;
    setIsSaving(true);
    const changesToSave = pendingChanges;
    try {
      const response = await fetch(
        `/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}/permissions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            dataroomId,
            groupId,
            permissions: changesToSave,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to save permissions");
      }

      toast.success("Permissions updated successfully.");
      await onSaved?.();
      setPendingChanges({});
    } catch (error) {
      console.error("Error saving permissions:", error);
      toast.error("Failed to update permissions", {
        description: "Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    hasPendingChanges,
    isSaving,
    pendingChanges,
    teamId,
    dataroomId,
    groupId,
    onSaved,
  ]);

  // Warn the user before they navigate away with unsaved permission changes.
  useEffect(() => {
    if (!hasPendingChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasPendingChanges]);

  const columns = useMemo(
    () => createColumns({ updatePermissions }),
    [updatePermissions],
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getSubRows: (row) => row.subItems,
    initialState: {
      expanded: {
        "0": true, // Always expand the root folder (first row)
      },
    },
    getRowCanExpand: (row) => {
      // Root folder is always expanded and cannot be collapsed
      if (row.original.id === VIRTUAL_ROOT_ID) {
        return true;
      }
      return (row.subRows?.length ?? 0) > 0;
    },
  });

  if (loading) return <div>Loading...</div>;

  const changedItemCount = Object.keys(pendingChanges).length;

  return (
    <div className="space-y-3">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "flex flex-col gap-3 rounded-md border px-4 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between",
          hasPendingChanges
            ? "border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/40"
            : "border-border bg-muted/40",
        )}
      >
        <div className="flex items-center gap-2 text-sm">
          {hasPendingChanges ? (
            <>
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full bg-amber-500"
              />
              <span className="font-medium text-amber-900 dark:text-amber-100">
                {changedItemCount} unsaved{" "}
                {changedItemCount === 1 ? "change" : "changes"}
              </span>
              <span className="text-muted-foreground">
                Save to apply your updates to this group.
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              All permission changes saved.
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDiscardChanges}
            disabled={!hasPendingChanges || isSaving}
          >
            Discard
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSaveChanges}
            disabled={!hasPendingChanges || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "rounded-md border",
          isSaving && "pointer-events-none opacity-60",
        )}
      >
        <Table className="table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header, index) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      "py-2",
                      index === 0
                        ? "w-auto"
                        : "w-[120px] whitespace-nowrap text-right",
                    )}
                  >
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
              table.getRowModel().rows.map((row) => {
                const isRoot = row.original.id === VIRTUAL_ROOT_ID;
                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className={cn(
                      isRoot && "bg-blue-50/50 dark:bg-blue-950/50",
                    )}
                  >
                    {row.getVisibleCells().map((cell, index) => (
                      <TableCell
                        key={cell.id}
                        style={
                          index === 0
                            ? {
                                paddingLeft: `${row.depth * 1.25}rem`,
                              }
                            : undefined
                        }
                        className={cn(
                          "py-2",
                          index === 0
                            ? "max-w-0"
                            : "w-[120px] whitespace-nowrap",
                        )}
                      >
                        <div
                          className={cn(
                            "min-w-0",
                            index !== 0 && "flex justify-end",
                          )}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
