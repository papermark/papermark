"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { ItemType, PermissionGroupAccessControls } from "@prisma/client";
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
  CrownIcon,
  EyeIcon,
  EyeOffIcon,
  File,
  Folder,
  HomeIcon,
} from "lucide-react";
import useSWR from "swr";

import { useFeatureFlags } from "@/lib/hooks/use-feature-flags";
import { usePlan } from "@/lib/swr/use-billing";
import { useDataroomFoldersTree } from "@/lib/swr/use-dataroom";
import { cn, fetcher } from "@/lib/utils";
import {
  HIERARCHICAL_DISPLAY_STYLE,
  getHierarchicalDisplayName,
} from "@/lib/utils/hierarchical-display";

import PlanBadge from "@/components/billing/plan-badge";
import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import CloudDownloadOff from "@/components/shared/icons/cloud-download-off";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const PermissionGroupItemName = ({ item }: { item: FileOrFolder }) => {
  const { isFeatureEnabled } = useFeatureFlags();
  const isDataroomIndexEnabled = isFeatureEnabled("dataroomIndex");

  const displayName = getHierarchicalDisplayName(
    item.name,
    item.hierarchicalIndex,
    isDataroomIndexEnabled,
  );

  const isRoot = item.id === "__dataroom_root__";

  return (
    <div className="flex items-center text-foreground">
      {isRoot ? (
        <HomeIcon className="mr-2 h-5 w-5" />
      ) : item.itemType === ItemType.DATAROOM_FOLDER ? (
        <Folder className="mr-2 h-5 w-5" />
      ) : (
        <File className="mr-2 h-5 w-5" />
      )}
      <span className="truncate" style={HIERARCHICAL_DISPLAY_STYLE}>
        {displayName}
      </span>
    </div>
  );
};

// FileOrFolder type for link permissions
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

type ItemPermission = Record<
  string,
  { view: boolean; download: boolean; itemType: ItemType }
>;

type ColumnExtra = {
  updatePermissions: (id: string, newPermissions: string[]) => void;
};

const createColumns = (extra: ColumnExtra): ColumnDef<FileOrFolder>[] => [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => {
      const isRoot = row.original.id === "__dataroom_root__";
      return (
        <div className="flex items-center text-foreground">
          {isRoot ? (
            <div className="h-6 w-6 shrink-0" />
          ) : row.getCanExpand() ? (
            <Button
              variant="ghost"
              onClick={row.getToggleExpandedHandler()}
              className="mr-1 h-6 w-6 shrink-0 p-0"
              disabled={isRoot} // Root is always expanded
            >
              {row.getIsExpanded() ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          ) : (
            <div className="mr-1 h-6 w-6 shrink-0" /> // Placeholder to maintain alignment
          )}
          <PermissionGroupItemName item={row.original} />
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

      return (
        <ToggleGroup
          type="multiple"
          value={Object.entries(item.permissions)
            .filter(([_, value]) => value)
            .map(([key, _]) => key)}
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

// Build tree function adapted for link permissions with virtual root
const buildTree = (
  items: any[],
  permissions: PermissionGroupAccessControls[],
  parentId: string | null = null,
): FileOrFolder[] => {
  const getPermissions = (id: string) => {
    const permission = permissions.find((p) => p.itemId === id);

    // If we have permission data loaded, use it. Otherwise default to true for new links.
    const hasPermissionData = permissions.length > 0;

    return {
      view: permission ? permission.canView : hasPermissionData ? false : true,
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

      // Calculate view and partialView for folders
      let viewStatus = folderPermissions.view;
      let partialView = false;
      let downloadStatus = folderPermissions.download;
      let partialDownload = false;

      if (allSubItems.length > 0) {
        const viewableItems = allSubItems.filter(
          (item) => item.permissions.view,
        );
        const downloadableItems = allSubItems.filter(
          (item) => item.permissions.download,
        );

        viewStatus = viewableItems.length > 0;
        partialView =
          viewableItems.length > 0 && viewableItems.length < allSubItems.length;
        downloadStatus = downloadableItems.length > 0;
        partialDownload =
          downloadableItems.length > 0 &&
          downloadableItems.length < allSubItems.length;
      }

      result.push({
        id: folder.id,
        name: folder.name,
        hierarchicalIndex: folder.hierarchicalIndex,
        subItems: allSubItems,
        permissions: {
          view: viewStatus,
          download: downloadStatus,
          partialView,
          partialDownload,
        },
        itemType: ItemType.DATAROOM_FOLDER,
      });
    });

  // Handle documents that are direct children of the current parent (including root level)
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
  permissions: PermissionGroupAccessControls[],
  dataroomName: string = "Dataroom Home",
): FileOrFolder[] => {
  // Get all items (folders and root documents) - buildTree already handles root documents when parentId is null
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
      id: "__dataroom_root__",
      name: dataroomName,
      subItems: allItems,
      permissions: rootPermissions,
      itemType: ItemType.DATAROOM_FOLDER,
    },
  ];
};

interface PermissionsSheetProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  dataroomId: string;
  linkId?: string; // For editing existing links
  permissionGroupId?: string | null; // For loading existing permissions
  onSave: (permissions: ItemPermission | null) => void;
  // initialPermissions?: PermissionGroupAccessControls[]; // Keep for backward compatibility
}

export function PermissionsSheet({
  isOpen,
  setIsOpen,
  dataroomId,
  linkId,
  permissionGroupId,
  onSave,
  // initialPermissions = [],
}: PermissionsSheetProps) {
  const { currentTeamId } = useTeam();
  const { isDatarooms, isDataroomsPlus, isTrial } = usePlan();

  // Check if custom permissions are allowed
  const canSetCustomPermissions = isDatarooms || isDataroomsPlus || isTrial;

  const { folders, loading } = useDataroomFoldersTree({
    dataroomId,
    include_documents: true,
  });

  // Fetch permission group data if permissionGroupId is provided
  const { data: permissionGroupData, isLoading: permissionGroupLoading } =
    useSWR<{
      permissionGroup: {
        id: string;
        name: string;
        description: string | null;
        accessControls: PermissionGroupAccessControls[];
      };
    }>(
      permissionGroupId && currentTeamId
        ? `/api/teams/${currentTeamId}/datarooms/${dataroomId}/permission-groups/${permissionGroupId}`
        : null,
      fetcher,
    );

  const [data, setData] = useState<FileOrFolder[]>([]);
  const [pendingChanges, setPendingChanges] = useState<ItemPermission>({});
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Determine the effective permissions to use
  const effectivePermissions = useMemo(() => {
    if (permissionGroupData?.permissionGroup?.accessControls) {
      return permissionGroupData.permissionGroup.accessControls;
    }
    return [];
  }, [permissionGroupData]);

  // Add state for the "share entire dataroom" toggle
  const [shareEntireDataroom, setShareEntireDataroom] = useState<boolean>(
    effectivePermissions.length === 0, // Default to true if no effective permissions
  );

  // Use ref to access current data without dependency
  const dataRef = useRef<FileOrFolder[]>([]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const updatePermissions = useCallback(
    (id: string, newPermissions: string[]) => {
      // When any permission is changed, turn off the "share entire dataroom" toggle
      setShareEntireDataroom(false);

      const isRoot = id === "__dataroom_root__";

      const findItemAndParents = (
        items: FileOrFolder[],
        targetId: string,
        parents: FileOrFolder[] = [],
      ): { item: FileOrFolder; parents: FileOrFolder[] } | null => {
        for (const item of items) {
          if (item.id === targetId) {
            return { item, parents };
          }
          if (item.subItems) {
            const result = findItemAndParents(item.subItems, targetId, [
              ...parents,
              item,
            ]);
            if (result) return result;
          }
        }
        return null;
      };

      const result = findItemAndParents(dataRef.current, id);
      if (!result) return;

      const { item, parents } = result;

      const updatedPermissions = {
        view: newPermissions.includes("view"),
        download: newPermissions.includes("download"),
        partialView: newPermissions.includes("partialView"),
        partialDownload: newPermissions.includes("partialDownload"),
      };

      // Special cases
      if (!updatedPermissions.view && item.permissions.download) {
        updatedPermissions.download = false;
      } else if (updatedPermissions.download && !updatedPermissions.view) {
        updatedPermissions.view = true;
      }

      if (updatedPermissions.partialDownload) {
        updatedPermissions.download = true;
      }

      if (updatedPermissions.partialView) {
        updatedPermissions.view = true;
      }

      // Handle root-level permissions (affects all items)
      if (isRoot) {
        setData((prevData) => {
          const updateAllItems = (items: FileOrFolder[]): FileOrFolder[] => {
            return items.map((currentItem) => {
              if (currentItem.id === "__dataroom_root__") {
                return {
                  ...currentItem,
                  permissions: {
                    view: updatedPermissions.view,
                    download: updatedPermissions.download,
                    partialView: false,
                    partialDownload: false,
                  },
                  subItems: currentItem.subItems
                    ? updateAllItems(currentItem.subItems)
                    : undefined,
                };
              }

              const updatedItem = {
                ...currentItem,
                permissions: {
                  view: updatedPermissions.view,
                  download: updatedPermissions.download,
                  partialView: false,
                  partialDownload: false,
                },
                subItems: currentItem.subItems
                  ? updateAllItems(currentItem.subItems)
                  : undefined,
              };

              return updatedItem;
            });
          };

          return updateAllItems(prevData);
        });

        // Collect changes for all items
        const collectAllChanges = (items: FileOrFolder[]): ItemPermission => {
          let changes: ItemPermission = {};

          const processItems = (items: FileOrFolder[]) => {
            items.forEach((item) => {
              // Don't save the virtual __dataroom_root__ item to database
              if (item.id !== "__dataroom_root__") {
                changes[item.id] = {
                  view: updatedPermissions.view,
                  download: updatedPermissions.download,
                  itemType: item.itemType,
                };
              }

              if (item.subItems) {
                processItems(item.subItems);
              }
            });
          };

          processItems(items);
          return changes;
        };

        const rootChanges = collectAllChanges(dataRef.current);
        setPendingChanges((prev) => ({
          ...prev,
          ...rootChanges,
        }));

        return;
      }

      setData((prevData) => {
        const updateItemInTree = (items: FileOrFolder[]): FileOrFolder[] => {
          return items.map((currentItem) => {
            if (currentItem.id === id) {
              const updatedItem = {
                ...currentItem,
                permissions: {
                  view: updatedPermissions.view,
                  download: updatedPermissions.download,
                  partialView: false,
                  partialDownload: false,
                },
              };

              // If it's a folder, update all subitems
              if (updatedItem.itemType === ItemType.DATAROOM_FOLDER) {
                updatedItem.subItems = updateSubItems(
                  updatedItem.subItems || [],
                  updatedPermissions.view,
                  updatedPermissions.download,
                );
              }

              return updatedItem;
            }

            // if the current item is a parent of the updated item, update the parent's permissions
            if (parents.some((parent) => parent.id === currentItem.id)) {
              const updatedSubItems = currentItem.subItems
                ? updateItemInTree(currentItem.subItems)
                : [];
              return updateParentPermissions(currentItem, updatedSubItems);
            }

            // if the current item has subitems, update the subitems
            if (currentItem.subItems) {
              return {
                ...currentItem,
                subItems: updateItemInTree(currentItem.subItems),
              };
            }
            return currentItem;
          });
        };

        const updateSubItems = (
          items: FileOrFolder[],
          viewState: boolean,
          downloadState: boolean,
        ): FileOrFolder[] => {
          return items.map((item) => ({
            ...item,
            permissions: {
              ...item.permissions,
              view: viewState,
              partialView: false,
              partialDownload: false,
              download: downloadState,
            },
            subItems: item.subItems
              ? updateSubItems(item.subItems, viewState, downloadState)
              : undefined,
          }));
        };

        const updateParentPermissions = (
          parent: FileOrFolder,
          subItems: FileOrFolder[],
        ): FileOrFolder => {
          const isParentRoot = parent.id === "__dataroom_root__";

          // For root folder, calculate based on all descendants
          const calculatePermissions = (items: FileOrFolder[]) => {
            const flattenItems = (items: FileOrFolder[]): FileOrFolder[] => {
              return items.reduce((acc, item) => {
                if (item.id !== "__dataroom_root__") {
                  acc.push(item);
                }
                if (item.subItems) {
                  acc.push(...flattenItems(item.subItems));
                }
                return acc;
              }, [] as FileOrFolder[]);
            };

            const allItems = flattenItems(items);
            const viewableItems = allItems.filter(
              (item) => item.permissions.view,
            );
            const downloadableItems = allItems.filter(
              (item) => item.permissions.download,
            );

            return {
              view: viewableItems.length > 0,
              partialView:
                viewableItems.length > 0 &&
                viewableItems.length < allItems.length,
              download: downloadableItems.length > 0,
              partialDownload:
                downloadableItems.length > 0 &&
                downloadableItems.length < allItems.length,
            };
          };

          if (isParentRoot) {
            const rootPermissions = calculatePermissions(subItems);
            return {
              ...parent,
              permissions: rootPermissions,
              subItems,
            };
          }

          // For regular folders
          const someSubItemViewable = subItems.some(
            (subItem) => subItem.permissions.view,
          );
          const allSubItemsViewable = subItems.every(
            (subItem) => subItem.permissions.view,
          );
          const someSubItemDownloadable = subItems.some(
            (subItem) => subItem.permissions.download,
          );
          const allSubItemsDownloadable = subItems.every(
            (subItem) => subItem.permissions.download,
          );

          return {
            ...parent,
            permissions: {
              view: someSubItemViewable,
              partialView: someSubItemViewable && !allSubItemsViewable,
              download: someSubItemDownloadable,
              partialDownload:
                someSubItemDownloadable && !allSubItemsDownloadable,
            },
            subItems,
          };
        };

        return updateItemInTree(prevData);
      });

      // Collect changes for database update
      const collectChanges = (
        item: FileOrFolder,
        parents: FileOrFolder[],
      ): ItemPermission => {
        let changes: ItemPermission = {};

        // Don't save the virtual __dataroom_root__ item to database
        if (item.id !== "__dataroom_root__") {
          changes[item.id] = {
            view: updatedPermissions.view,
            download: updatedPermissions.download,
            itemType: item.itemType,
          };
        }

        // Collect changes for all subitems
        const collectSubItemChanges = (
          subItems: FileOrFolder[] | undefined,
        ) => {
          if (!subItems) return;
          subItems.forEach((subItem) => {
            // Don't save the virtual __dataroom_root__ item to database
            if (subItem.id !== "__dataroom_root__") {
              changes[subItem.id] = {
                view: updatedPermissions.view,
                download: updatedPermissions.download,
                itemType: subItem.itemType,
              };
            }
            collectSubItemChanges(subItem.subItems);
          });
        };

        collectSubItemChanges(item.subItems);

        // Ensure all parent folders are viewable if the item is being set to viewable
        if (updatedPermissions.view || updatedPermissions.download) {
          parents.forEach((parent) => {
            // Don't save the virtual __dataroom_root__ item to database
            if (parent.id !== "__dataroom_root__") {
              changes[parent.id] = {
                view: true,
                download: updatedPermissions.download
                  ? true
                  : parent.permissions.download,
                itemType: parent.itemType,
              };
            }
          });
        } else {
          // If turning off view, recalculate parent permissions
          [...parents].reverse().forEach((parent) => {
            // Don't save the virtual __dataroom_root__ item to database
            if (parent.id !== "__dataroom_root__") {
              const otherChildren =
                parent.subItems?.filter((subItem) => subItem.id !== item.id) ||
                [];
              const someSubItemViewable = otherChildren.some(
                (subItem) => subItem.permissions.view,
              );
              const someSubItemDownloadable = otherChildren.some(
                (subItem) => subItem.permissions.download,
              );

              changes[parent.id] = {
                view: someSubItemViewable,
                download: someSubItemDownloadable,
                itemType: parent.itemType,
              };
            }
          });
        }

        return changes;
      };

      setPendingChanges((prev) => ({
        ...prev,
        ...collectChanges(item, parents),
      }));
    },
    [], // Remove data dependency to prevent excessive re-renders
  );

  useEffect(() => {
    if (folders && !loading) {
      const treeData = buildTreeWithRoot(
        folders,
        effectivePermissions,
        "Dataroom Home",
      );
      setData(treeData);
    }
  }, [folders, loading, effectivePermissions]); // Add effectivePermissions as dependency

  // Reset settings when sheet opens for a new link
  useEffect(() => {
    if (isOpen) {
      // Reset to default state for new links
      setShareEntireDataroom(effectivePermissions.length === 0);
      setPendingChanges({});

      // For new links (no existing permissions), default to "share entire dataroom" on
      // But if they turn it off, they'll start with no permissions selected (opt-in approach)
      // For existing links, show the current permissions state
      if (effectivePermissions.length === 0) {
        // New link - start with full access shown but toggle is on
        setData((prevData) => {
          const resetToFullAccess = (items: FileOrFolder[]): FileOrFolder[] => {
            return items.map((item) => ({
              ...item,
              permissions: {
                view: true,
                download: false,
                partialView: false,
                partialDownload: false,
              },
              subItems: item.subItems
                ? resetToFullAccess(item.subItems)
                : undefined,
            }));
          };

          return resetToFullAccess(prevData);
        });
      }
    }
  }, [isOpen, effectivePermissions.length]);

  // Handle the "share entire dataroom" toggle
  const handleShareEntireDataroomToggle = (checked: boolean) => {
    setShareEntireDataroom(checked);
    if (checked) {
      // Clear pending changes when sharing entire dataroom
      setPendingChanges({});
      // Reset UI to show full access (but don't save to database)
      setData((prevData) => {
        const updateAllItems = (items: FileOrFolder[]): FileOrFolder[] => {
          return items.map((item) => {
            return {
              ...item,
              permissions: {
                view: true,
                download: false,
                partialView: false,
                partialDownload: false,
              },
              subItems: item.subItems
                ? updateAllItems(item.subItems)
                : undefined,
            };
          });
        };

        return updateAllItems(prevData);
      });
    } else {
      // When turning off, reset all permissions to false so user must opt-in
      setPendingChanges({});
      setData((prevData) => {
        const resetToNoAccess = (items: FileOrFolder[]): FileOrFolder[] => {
          return items.map((item) => {
            return {
              ...item,
              permissions: {
                view: false,
                download: false,
                partialView: false,
                partialDownload: false,
              },
              subItems: item.subItems
                ? resetToNoAccess(item.subItems)
                : undefined,
            };
          });
        };

        return resetToNoAccess(prevData);
      });
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // If sharing entire dataroom, pass null to indicate no specific permissions
      if (shareEntireDataroom) {
        await onSave(null);
      } else {
        // Merge existing permissions with pending changes
        const completePermissions: ItemPermission = {};

        // First, add all existing permissions
        effectivePermissions.forEach((permission) => {
          completePermissions[permission.itemId] = {
            view: permission.canView,
            download: permission.canDownload,
            itemType: permission.itemType,
          };
        });

        // Then, apply pending changes (this will override existing permissions for changed items)
        Object.keys(pendingChanges).forEach((itemId) => {
          completePermissions[itemId] = pendingChanges[itemId];
        });

        await onSave(completePermissions);
      }

      setIsOpen(false);
      // Clear pending changes after the sheet is closed to avoid UI flickering
      setPendingChanges({});
    } catch (error) {
      console.error("Error saving permissions:", error);
    } finally {
      setIsSaving(false);
    }
  };

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
      if (row.original.id === "__dataroom_root__") {
        return true;
      }
      return (row.subRows?.length ?? 0) > 0;
    },
  });

  if (loading) return null;

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent className="flex w-[90%] flex-col justify-between border-l border-gray-200 bg-background px-4 text-foreground dark:border-gray-800 dark:bg-gray-900 sm:w-[780px] sm:max-w-3xl md:px-5">
        <SheetHeader className="text-start">
          <SheetTitle>Manage File Permissions</SheetTitle>
          <p className="text-sm text-muted-foreground">
            Use the toggle below to share all dataroom contents or set specific
            permissions.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-auto py-4">
          {/* Share Entire Dataroom Toggle */}
          <div className="mb-6 rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium">Share Entire Dataroom</h4>
                  {!canSetCustomPermissions && (
                    <UpgradePlanModal
                      clickedPlan={PlanEnum.DataRooms}
                      trigger="dataroom_permissions_sheet_toggle"
                    >
                      <button
                        type="button"
                        className="inline-flex cursor-pointer rounded-md transition-colors hover:bg-muted/50"
                      >
                        <PlanBadge plan={PlanEnum.DataRooms} />
                      </button>
                    </UpgradePlanModal>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Turn off to set specific permissions for individual items.
                  When turned off, no items are selected by default - you must
                  choose what to share.
                </p>
              </div>
              {!canSetCustomPermissions ? (
                <Switch
                  checked={true}
                  className="cursor-not-allowed opacity-50"
                  onCheckedChange={undefined}
                />
              ) : (
                <Switch
                  checked={shareEntireDataroom}
                  onCheckedChange={handleShareEntireDataroomToggle}
                />
              )}
            </div>
          </div>

          {/* Permissions Table */}
          <div
            className={cn(
              "rounded-md border",
              (shareEntireDataroom || !canSetCustomPermissions) && "opacity-50",
            )}
          >
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className="py-2 last:text-right"
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
              <TableBody className="transition-all duration-200 ease-in-out">
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => {
                    const isRoot = row.original.id === "__dataroom_root__";
                    return (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() && "selected"}
                        className={cn(
                          "transition-all duration-200 ease-in-out",
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
                            className="py-2 last:flex last:justify-end"
                          >
                            <div
                              className={cn(
                                (shareEntireDataroom ||
                                  !canSetCustomPermissions) &&
                                  "pointer-events-none",
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
                      No files found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <SheetFooter>
          <div className="flex flex-row-reverse items-center gap-2 pt-2">
            <Button
              type="button"
              loading={isSaving}
              onClick={handleSave}
              disabled={
                shareEntireDataroom
                  ? false
                  : Object.keys(pendingChanges).length === 0
              }
            >
              Save & Share
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
