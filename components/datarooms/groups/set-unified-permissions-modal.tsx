import { useCallback, useEffect, useMemo, useState } from "react";

import { useTeam } from "@/context/team-context";
import { ItemType } from "@prisma/client";
import {
  ArrowDownToLineIcon,
  ArrowLeftIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  FolderIcon,
  LinkIcon,
  Loader2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import {
  DataroomFolderWithDocuments,
  useDataroomFoldersTree,
  useDataroomLinks,
} from "@/lib/swr/use-dataroom";
import useDataroomGroups from "@/lib/swr/use-dataroom-groups";
import useDataroomPermissionGroups from "@/lib/swr/use-dataroom-permission-groups";
import { cn } from "@/lib/utils";

import CloudDownloadOff from "@/components/shared/icons/cloud-download-off";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toggle } from "@/components/ui/toggle";

type GroupPermissions = Record<string, { view: boolean; download: boolean }>;
type LinkPermissions = Record<string, { view: boolean; download: boolean }>;

/**
 * An item the modal sets permissions for. Can be a single document or a
 * folder. When `itemType` is `folder`, the modal cascades the chosen view /
 * download permission to every descendant document and sub-folder so the
 * user can configure access for the whole tree with one click.
 */
export type UnifiedPermissionItem = {
  fileName: string;
  /** Defaults to "document" for backward compatibility with existing callers. */
  itemType?: "document" | "folder";
  // Document fields
  documentId?: string;
  dataroomDocumentId?: string;
  // Folder field
  dataroomFolderId?: string;
};

type InternalItem = {
  key: string;
  type: "document" | "folder";
  name: string;
  // Always present
  primaryId: string; // dataroomDocumentId or dataroomFolderId
  // For documents only — used to mutate the per-document groups SWR cache
  documentId?: string;
};

function normalizeItems(items: UnifiedPermissionItem[]): InternalItem[] {
  return items
    .map((item): InternalItem | null => {
      const type = item.itemType ?? "document";
      if (type === "folder") {
        if (!item.dataroomFolderId) return null;
        return {
          key: `folder:${item.dataroomFolderId}`,
          type: "folder",
          name: item.fileName,
          primaryId: item.dataroomFolderId,
        };
      }
      if (!item.dataroomDocumentId) return null;
      return {
        key: `document:${item.dataroomDocumentId}`,
        type: "document",
        name: item.fileName,
        primaryId: item.dataroomDocumentId,
        documentId: item.documentId,
      };
    })
    .filter((x): x is InternalItem => x !== null);
}

/**
 * Walk down the (flat) dataroom folder list starting from `rootFolderId` and
 * collect every descendant folder id and dataroom-document id. The list of
 * folders comes from `useDataroomFoldersTree({ include_documents: true })`
 * which already includes the documents directly inside each folder.
 */
function collectFolderDescendants(
  rootFolderId: string,
  folders: DataroomFolderWithDocuments[] | undefined,
): { folderIds: string[]; documentIds: string[] } {
  if (!folders) return { folderIds: [], documentIds: [] };

  const childrenByParent = new Map<string, DataroomFolderWithDocuments[]>();
  for (const folder of folders) {
    const parent = folder.parentId ?? "__root__";
    const arr = childrenByParent.get(parent) ?? [];
    arr.push(folder);
    childrenByParent.set(parent, arr);
  }

  const documentsByFolder = new Map<string, { id: string }[]>();
  for (const folder of folders) {
    documentsByFolder.set(folder.id, folder.documents ?? []);
  }

  const folderIds: string[] = [];
  const documentIds: string[] = [];

  const stack: string[] = [rootFolderId];
  while (stack.length) {
    const current = stack.pop()!;
    for (const doc of documentsByFolder.get(current) ?? []) {
      documentIds.push(doc.id);
    }
    for (const child of childrenByParent.get(current) ?? []) {
      folderIds.push(child.id);
      stack.push(child.id);
    }
  }

  return { folderIds, documentIds };
}

export function SetUnifiedPermissionsModal({
  open,
  setOpen,
  dataroomId,
  onComplete,
  uploadedFiles,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  dataroomId: string;
  onComplete?: () => void;
  uploadedFiles: UnifiedPermissionItem[];
}) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const items = useMemo(() => normalizeItems(uploadedFiles), [uploadedFiles]);

  const [selectedKey, setSelectedKey] = useState<string | null>(
    items.length === 1 ? items[0].key : null,
  );
  const [showFileListState, setShowFileListState] = useState(items.length > 1);

  // When the incoming items change (e.g. an upload completes), reset which
  // file is currently being edited so we don't get stuck pointing at a stale
  // selection.
  useEffect(() => {
    if (items.length === 1) {
      setSelectedKey(items[0].key);
      setShowFileListState(false);
    } else if (items.length > 1) {
      setSelectedKey(null);
      setShowFileListState(true);
    }
  }, [items]);

  const selectedItem = useMemo(
    () => items.find((item) => item.key === selectedKey) ?? null,
    [items, selectedKey],
  );

  // Folder tree — only fetched while the modal is open. We need it both to
  // count items inside a folder (so we can tell the user "this applies to N
  // items") and to cascade permission changes to every descendant.
  const { folders: folderTree, loading: folderTreeLoading } =
    useDataroomFoldersTree({
      dataroomId,
      include_documents: true,
    });

  // Right after a folder upload the cached tree won't yet include the new
  // folder or its children. Force a refresh whenever the modal opens with a
  // folder selection so we cascade to every freshly-created sub-item.
  useEffect(() => {
    if (!open || !teamId) return;
    const hasFolderItem = items.some((item) => item.type === "folder");
    if (!hasFolderItem) return;
    mutate(
      `/api/teams/${teamId}/datarooms/${dataroomId}/folders?include_documents=true`,
    );
  }, [open, items, teamId, dataroomId]);

  const folderDescendants = useMemo(() => {
    if (!selectedItem || selectedItem.type !== "folder") return null;
    return collectFolderDescendants(selectedItem.primaryId, folderTree);
  }, [selectedItem, folderTree]);

  // Scope the groups query to the currently selected item so we get the
  // existing access controls (if any) for it. The server returns the same
  // group list either way; the access controls just get filtered.
  const documentIdForGroupsQuery =
    selectedItem?.type === "document" ? selectedItem.primaryId : undefined;
  const folderIdForGroupsQuery =
    selectedItem?.type === "folder" ? selectedItem.primaryId : undefined;

  const {
    viewerGroups,
    loading: viewerGroupsLoading,
    mutate: mutateViewerGroups,
  } = useDataroomGroups({
    documentId: documentIdForGroupsQuery,
    folderId: folderIdForGroupsQuery,
    dataroomId,
  });

  const { links, loading: linksLoading } = useDataroomLinks();
  const { permissionGroups, loading: permissionGroupsLoading } =
    useDataroomPermissionGroups();

  const linksWithPermissionGroups = useMemo(() => {
    if (!links || !permissionGroups) return [];
    return links
      .filter(
        (link) =>
          link.permissionGroupId &&
          permissionGroups.some((pg) => pg.id === link.permissionGroupId),
      )
      .map((link) => ({
        ...link,
        permissionGroup: permissionGroups.find(
          (pg) => pg.id === link.permissionGroupId,
        ),
      }));
  }, [links, permissionGroups]);

  // Per-item permission edits keyed by InternalItem.key. Allows quickly
  // switching between files when the user is processing a batch upload.
  const [filePermissions, setFilePermissions] = useState<
    Record<
      string,
      { groupPermissions: GroupPermissions; linkPermissions: LinkPermissions }
    >
  >({});
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // Refresh viewer groups when switching items so the toggles reflect the
  // currently persisted state for that item.
  useEffect(() => {
    if (selectedItem) {
      mutateViewerGroups();
    }
  }, [selectedItem, mutateViewerGroups]);

  // Compute the initial "what is currently saved on the server" state for the
  // selected item, used both as the starting toggle values and to detect
  // what's changed when the user clicks save.
  const initialGroupPermissions = useMemo<GroupPermissions>(() => {
    if (!viewerGroups || !selectedItem) return {};

    // The groups endpoint already scopes accessControls to the current item
    // (document or folder) — there's at most one row per group.
    const permissions: GroupPermissions = {};
    viewerGroups.forEach((group) => {
      permissions[group.id] = {
        view: group.accessControls?.[0]?.canView ?? false,
        download: group.accessControls?.[0]?.canDownload ?? false,
      };
    });
    return permissions;
  }, [viewerGroups, selectedItem]);

  const initialLinkPermissions = useMemo<LinkPermissions>(() => {
    if (!linksWithPermissionGroups || !selectedItem) return {};
    const permissions: LinkPermissions = {};
    linksWithPermissionGroups.forEach((link) => {
      const documentPermission = link.permissionGroup?.accessControls?.find(
        (ac) => ac.itemId === selectedItem.primaryId,
      );
      permissions[link.id] = {
        view: documentPermission?.canView ?? false,
        download: documentPermission?.canDownload ?? false,
      };
    });
    return permissions;
  }, [linksWithPermissionGroups, selectedItem]);

  useEffect(() => {
    if (!selectedItem) return;
    setFilePermissions((prev) => ({
      ...prev,
      [selectedItem.key]: {
        groupPermissions: initialGroupPermissions,
        linkPermissions: prev[selectedItem.key]?.linkPermissions || {},
      },
    }));
  }, [initialGroupPermissions, selectedItem]);

  useEffect(() => {
    if (!selectedItem) return;
    setFilePermissions((prev) => ({
      ...prev,
      [selectedItem.key]: {
        groupPermissions: prev[selectedItem.key]?.groupPermissions || {},
        linkPermissions: initialLinkPermissions,
      },
    }));
  }, [initialLinkPermissions, selectedItem]);

  const selectedGroupPermissions = useMemo(() => {
    if (!selectedItem) return {};
    return filePermissions[selectedItem.key]?.groupPermissions || {};
  }, [filePermissions, selectedItem]);

  const selectedLinkPermissions = useMemo(() => {
    if (!selectedItem) return {};
    return filePermissions[selectedItem.key]?.linkPermissions || {};
  }, [filePermissions, selectedItem]);

  const setGroupPerm = useCallback(
    (groupId: string, next: Partial<{ view: boolean; download: boolean }>) => {
      if (!selectedItem) return;

      setFilePermissions((prev) => {
        const current = prev[selectedItem.key]?.groupPermissions?.[groupId] || {
          view: false,
          download: false,
        };
        let view = next.view ?? current.view;
        let download = next.download ?? current.download;
        // Enforce invariants: download requires view; turning view off turns
        // download off too. Matches the server-side intent.
        if (download && !view) view = true;
        if (!view) download = false;

        return {
          ...prev,
          [selectedItem.key]: {
            groupPermissions: {
              ...prev[selectedItem.key]?.groupPermissions,
              [groupId]: { view, download },
            },
            linkPermissions: prev[selectedItem.key]?.linkPermissions || {},
          },
        };
      });
    },
    [selectedItem],
  );

  const setLinkPerm = useCallback(
    (linkId: string, next: Partial<{ view: boolean; download: boolean }>) => {
      if (!selectedItem) return;

      setFilePermissions((prev) => {
        const current = prev[selectedItem.key]?.linkPermissions?.[linkId] || {
          view: false,
          download: false,
        };
        let view = next.view ?? current.view;
        let download = next.download ?? current.download;
        if (download && !view) view = true;
        if (!view) download = false;

        return {
          ...prev,
          [selectedItem.key]: {
            groupPermissions: prev[selectedItem.key]?.groupPermissions || {},
            linkPermissions: {
              ...prev[selectedItem.key]?.linkPermissions,
              [linkId]: { view, download },
            },
          },
        };
      });
    },
    [selectedItem],
  );

  const enableViewForAll = useCallback(() => {
    if (!selectedItem) return;
    const newGroupPermissions = { ...selectedGroupPermissions };
    viewerGroups?.forEach((group) => {
      newGroupPermissions[group.id] = {
        ...newGroupPermissions[group.id],
        view: true,
      };
    });
    const newLinkPermissions = { ...selectedLinkPermissions };
    linksWithPermissionGroups?.forEach((link) => {
      newLinkPermissions[link.id] = {
        ...newLinkPermissions[link.id],
        view: true,
      };
    });
    setFilePermissions((prev) => ({
      ...prev,
      [selectedItem.key]: {
        groupPermissions: newGroupPermissions,
        linkPermissions: newLinkPermissions,
      },
    }));
  }, [
    selectedGroupPermissions,
    selectedLinkPermissions,
    viewerGroups,
    linksWithPermissionGroups,
    selectedItem,
  ]);

  const enableDownloadForAll = useCallback(() => {
    if (!selectedItem) return;
    const newGroupPermissions = { ...selectedGroupPermissions };
    viewerGroups?.forEach((group) => {
      newGroupPermissions[group.id] = { view: true, download: true };
    });
    const newLinkPermissions = { ...selectedLinkPermissions };
    linksWithPermissionGroups?.forEach((link) => {
      newLinkPermissions[link.id] = { view: true, download: true };
    });
    setFilePermissions((prev) => ({
      ...prev,
      [selectedItem.key]: {
        groupPermissions: newGroupPermissions,
        linkPermissions: newLinkPermissions,
      },
    }));
  }, [
    selectedGroupPermissions,
    selectedLinkPermissions,
    viewerGroups,
    linksWithPermissionGroups,
    selectedItem,
  ]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!selectedItem) return;
      setLoading(true);

      // Build the set of (id, itemType) pairs to write to. For a single
      // document this is just the document. For a folder we cascade to the
      // folder itself plus every descendant folder and document so a single
      // toggle gives the user access to (or hides) the whole tree.
      const targets: { itemId: string; itemType: ItemType }[] = [];
      if (selectedItem.type === "document") {
        targets.push({
          itemId: selectedItem.primaryId,
          itemType: ItemType.DATAROOM_DOCUMENT,
        });
      } else {
        targets.push({
          itemId: selectedItem.primaryId,
          itemType: ItemType.DATAROOM_FOLDER,
        });
        const descendants = folderDescendants ?? {
          folderIds: [],
          documentIds: [],
        };
        for (const folderId of descendants.folderIds) {
          targets.push({
            itemId: folderId,
            itemType: ItemType.DATAROOM_FOLDER,
          });
        }
        for (const documentId of descendants.documentIds) {
          targets.push({
            itemId: documentId,
            itemType: ItemType.DATAROOM_DOCUMENT,
          });
        }
      }

      try {
        const viewerGroupPromises = Object.entries(selectedGroupPermissions)
          .filter(([groupId, permissions]) => {
            // Save whenever the user changed anything, including toggling
            // everything off. The server upserts to view=false,download=false
            // which effectively revokes access — required for the "remove
            // access" flow to actually persist.
            const initial = initialGroupPermissions[groupId];
            return (
              !initial ||
              initial.view !== permissions.view ||
              initial.download !== permissions.download
            );
          })
          .map(([groupId, permissions]) => {
            const payload: Record<
              string,
              { itemType: ItemType; view: boolean; download: boolean }
            > = {};
            for (const target of targets) {
              payload[target.itemId] = {
                itemType: target.itemType,
                view: permissions.view,
                download: permissions.download,
              };
            }
            return fetch(
              `/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}/permissions`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  dataroomId,
                  groupId,
                  permissions: payload,
                }),
              },
            );
          });

        const linksNeedingUpdate = Object.entries(selectedLinkPermissions)
          .filter(([linkId, permissions]) => {
            const initial = initialLinkPermissions[linkId];
            return (
              !initial ||
              initial.view !== permissions.view ||
              initial.download !== permissions.download
            );
          })
          .map(([linkId, permissions]) => ({ linkId, permissions }));

        const linkPromises = linksNeedingUpdate.map(
          async ({ linkId, permissions }) => {
            const link = linksWithPermissionGroups.find((l) => l.id === linkId);
            if (!link?.permissionGroupId) return Promise.resolve();

            const existingPermissionsResponse = await fetch(
              `/api/teams/${teamId}/datarooms/${dataroomId}/permission-groups/${link.permissionGroupId}`,
            );
            if (!existingPermissionsResponse.ok) {
              throw new Error("Failed to fetch existing permissions");
            }
            const { permissionGroup } =
              await existingPermissionsResponse.json();

            const allPermissions: Record<
              string,
              { view: boolean; download: boolean; itemType: ItemType }
            > = {};
            permissionGroup.accessControls.forEach((control: any) => {
              allPermissions[control.itemId] = {
                view: control.canView,
                download: control.canDownload,
                itemType: control.itemType,
              };
            });

            for (const target of targets) {
              if (permissions.view || permissions.download) {
                allPermissions[target.itemId] = {
                  itemType: target.itemType,
                  view: permissions.view,
                  download: permissions.download,
                };
              } else {
                delete allPermissions[target.itemId];
              }
            }

            return fetch(
              `/api/teams/${teamId}/datarooms/${dataroomId}/permission-groups/${link.permissionGroupId}`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ permissions: allPermissions, linkId }),
              },
            );
          },
        );

        await Promise.all([...viewerGroupPromises, ...linkPromises]);

        toast.success("Permissions updated successfully!");

        await Promise.all([
          mutateViewerGroups(),
          selectedItem.type === "document" && selectedItem.documentId
            ? mutate(
                `/api/teams/${teamId}/datarooms/${dataroomId}/groups?documentId=${selectedItem.documentId}`,
              )
            : Promise.resolve(),
          mutate(
            `/api/teams/${teamId}/datarooms/${dataroomId}/permission-groups`,
          ),
          mutate(`/api/teams/${teamId}/datarooms/${dataroomId}/links`),
        ]);

        setSavedKeys((prev) => new Set([...prev, selectedItem.key]));

        if (items.length > 1) {
          const next = items.find(
            (it) => it.key !== selectedItem.key && !savedKeys.has(it.key),
          );
          if (next) {
            setSelectedKey(next.key);
            setShowFileListState(false);
          } else {
            onComplete?.();
            setOpen(false);
          }
        } else {
          onComplete?.();
          setOpen(false);
        }
      } catch (error) {
        console.error("Error updating permissions:", error);
        toast.error("Failed to update permissions");
      } finally {
        setLoading(false);
      }
    },
    [
      selectedItem,
      selectedGroupPermissions,
      selectedLinkPermissions,
      initialGroupPermissions,
      initialLinkPermissions,
      teamId,
      dataroomId,
      linksWithPermissionGroups,
      mutateViewerGroups,
      items,
      savedKeys,
      onComplete,
      setOpen,
      folderDescendants,
    ],
  );

  const isLoading =
    viewerGroupsLoading ||
    linksLoading ||
    permissionGroupsLoading ||
    (selectedItem?.type === "folder" && folderTreeLoading);

  const hasViewerGroups = !!viewerGroups && viewerGroups.length > 0;
  const hasLinks = linksWithPermissionGroups.length > 0;
  const hasAnyPermissions = hasViewerGroups || hasLinks;

  const folderDescendantCount = folderDescendants
    ? folderDescendants.folderIds.length + folderDescendants.documentIds.length
    : 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-0 p-0 sm:max-w-[560px] md:max-w-[640px]">
        <DialogHeader className="space-y-1 border-b px-6 py-5">
          <div className="flex items-start gap-2">
            {!showFileListState && items.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowFileListState(true)}
                className="-ml-2 h-7 w-7"
                aria-label="Back to file list"
              >
                <ArrowLeftIcon className="h-4 w-4" />
              </Button>
            )}
            <div className="flex-1">
              <DialogTitle className="text-base">
                {showFileListState
                  ? "Set permissions"
                  : selectedItem
                    ? `Set permissions for ${selectedItem.name}`
                    : "Set permissions"}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {showFileListState
                  ? savedKeys.size === items.length
                    ? "All items have been updated."
                    : `Choose an item to configure (${savedKeys.size}/${items.length} done)`
                  : selectedItem?.type === "folder"
                    ? folderTreeLoading
                      ? "Loading folder contents…"
                      : folderDescendantCount > 0
                        ? `Applies to this folder and ${folderDescendantCount} ${
                            folderDescendantCount === 1 ? "item" : "items"
                          } inside`
                        : "Applies to this folder"
                    : "Choose who can view and download this file"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {showFileListState ? (
          <div className="max-h-[60vh] space-y-1.5 overflow-y-auto px-6 py-5">
            {items.map((item) => {
              const isSaved = savedKeys.has(item.key);
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setSelectedKey(item.key);
                    setShowFileListState(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md border bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                    isSaved &&
                      "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/30",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {item.type === "folder" ? (
                      <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileTextIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate text-sm">{item.name}</span>
                  </div>
                  {isSaved ? (
                    <span className="ml-3 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
                      <CheckIcon className="h-3.5 w-3.5" />
                      Saved
                    </span>
                  ) : (
                    <span className="ml-3 text-xs text-muted-foreground">
                      Configure
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="contents">
            <div className="space-y-5 px-6 py-5">
              {selectedItem ? (
                <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
                  {selectedItem.type === "folder" ? (
                    <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileTextIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {selectedItem.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedItem.type === "folder"
                        ? folderTreeLoading
                          ? "Folder · loading…"
                          : `Folder · ${folderDescendantCount} ${
                              folderDescendantCount === 1 ? "item" : "items"
                            } inside`
                        : "File"}
                    </p>
                  </div>
                </div>
              ) : null}

              {hasAnyPermissions ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={enableViewForAll}
                    className="h-8"
                  >
                    <EyeIcon className="mr-1.5 h-3.5 w-3.5" />
                    Enable view for all
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={enableDownloadForAll}
                    className="h-8"
                  >
                    <ArrowDownToLineIcon className="mr-1.5 h-3.5 w-3.5" />
                    Enable download for all
                  </Button>
                </div>
              ) : null}

              <div className="rounded-md border">
                <div className="max-h-[44vh] overflow-y-auto">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : !hasAnyPermissions ? (
                    <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                      No groups or links yet. Create a viewer group or share
                      link first to configure permissions.
                    </div>
                  ) : (
                    <>
                      {hasViewerGroups ? (
                        <PermissionSection
                          icon={<Users className="h-3.5 w-3.5" />}
                          label="Viewer Groups"
                        >
                          {viewerGroups!.map((group) => {
                            const perm = selectedGroupPermissions[group.id] || {
                              view: false,
                              download: false,
                            };
                            return (
                              <PermissionRow
                                key={group.id}
                                primary={group.name}
                                secondary={`${group._count.members} member${
                                  group._count.members === 1 ? "" : "s"
                                }`}
                                view={perm.view}
                                download={perm.download}
                                onView={(view) =>
                                  setGroupPerm(group.id, { view })
                                }
                                onDownload={(download) =>
                                  setGroupPerm(group.id, { download })
                                }
                              />
                            );
                          })}
                        </PermissionSection>
                      ) : null}

                      {hasLinks ? (
                        <PermissionSection
                          icon={<LinkIcon className="h-3.5 w-3.5" />}
                          label="Links"
                          withTopBorder={hasViewerGroups}
                        >
                          {linksWithPermissionGroups.map((link) => {
                            const perm = selectedLinkPermissions[link.id] || {
                              view: false,
                              download: false,
                            };
                            const primary =
                              link.name || `Link #${link.id.slice(-5)}`;
                            const secondary =
                              link.domainId && link.slug
                                ? `${link.domainSlug}/${link.slug}`
                                : `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${link.id}`;
                            return (
                              <PermissionRow
                                key={link.id}
                                primary={primary}
                                secondary={secondary}
                                view={perm.view}
                                download={perm.download}
                                onView={(view) =>
                                  setLinkPerm(link.id, { view })
                                }
                                onDownload={(download) =>
                                  setLinkPerm(link.id, { download })
                                }
                              />
                            );
                          })}
                        </PermissionSection>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter className="border-t bg-muted/30 px-6 py-3">
              <Button
                type="submit"
                loading={loading}
                disabled={!hasAnyPermissions || !selectedItem}
              >
                {items.length > 1
                  ? (() => {
                      const remaining = items.filter(
                        (it) =>
                          it.key !== selectedItem?.key &&
                          !savedKeys.has(it.key),
                      );
                      return remaining.length > 0
                        ? "Save & next"
                        : "Save & finish";
                    })()
                  : "Save permissions"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PermissionSection({
  icon,
  label,
  withTopBorder,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  withTopBorder?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(withTopBorder && "border-t")}>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-muted/60 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-muted/50">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span className="w-16 text-center">View</span>
          <span className="w-16 text-center">Download</span>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function PermissionRow({
  primary,
  secondary,
  view,
  download,
  onView,
  onDownload,
}: {
  primary: string;
  secondary?: string;
  view: boolean;
  download: boolean;
  onView: (next: boolean) => void;
  onDownload: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{primary}</p>
        {secondary ? (
          <p className="truncate text-xs text-muted-foreground">{secondary}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="flex w-16 justify-center">
          <PermissionToggle
            pressed={view}
            onPressedChange={onView}
            aria-label="Toggle view"
            ariaLabelOn="View enabled"
            ariaLabelOff="View disabled"
          >
            {view ? (
              <EyeIcon className="h-4 w-4" />
            ) : (
              <EyeOffIcon className="h-4 w-4" />
            )}
          </PermissionToggle>
        </div>
        <div className="flex w-16 justify-center">
          <PermissionToggle
            pressed={download}
            onPressedChange={onDownload}
            aria-label="Toggle download"
            ariaLabelOn="Download enabled"
            ariaLabelOff="Download disabled"
          >
            {download ? (
              <ArrowDownToLineIcon className="h-4 w-4" />
            ) : (
              <CloudDownloadOff className="h-4 w-4" />
            )}
          </PermissionToggle>
        </div>
      </div>
    </div>
  );
}

function PermissionToggle({
  pressed,
  onPressedChange,
  ariaLabelOn,
  ariaLabelOff,
  children,
  ...rest
}: {
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  ariaLabelOn: string;
  ariaLabelOff: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <Toggle
      size="sm"
      pressed={pressed}
      onPressedChange={onPressedChange}
      aria-label={pressed ? ariaLabelOn : ariaLabelOff}
      className={cn(
        "h-9 w-9 p-0 text-muted-foreground hover:bg-muted hover:text-foreground data-[state=on]:bg-foreground data-[state=on]:text-background",
      )}
      {...rest}
    >
      {children}
    </Toggle>
  );
}
