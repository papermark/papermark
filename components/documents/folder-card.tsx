import Link from "next/link";
import { useRouter } from "next/router";

import { useEffect, useRef, useState } from "react";

import { TeamContextType } from "@/context/team-context";
import {
  BetweenHorizontalStartIcon,
  ChevronRight,
  ClipboardCopyIcon,
  CopyIcon,
  DownloadIcon,
  EyeOffIcon,
  FileSlidersIcon,
  FolderIcon,
  FolderInputIcon,
  FolderPenIcon,
  MoreVertical,
  PackagePlusIcon,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import { getFolderColorClasses, getFolderIcon } from "@/lib/constants/folder-constants";
import { DataroomFolderWithCount } from "@/lib/swr/use-dataroom";
import { FolderWithCount, FolderWithCountAndPath } from "@/lib/swr/use-documents";
import { getBreadcrumbPath, timeAgo } from "@/lib/utils";
import {
  HIERARCHICAL_DISPLAY_STYLE,
  useHierarchicalDisplayName,
} from "@/lib/utils/hierarchical-display";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { DownloadProgressModal } from "../datarooms/download-progress-modal";
import { SetUnifiedPermissionsModal } from "../datarooms/groups/set-unified-permissions-modal";
import { MoveToDataroomFolderModal } from "../datarooms/move-dataroom-folder-modal";
import { EditFolderModal } from "../folders/edit-folder-modal";
import { AddFolderToDataroomModal } from "./add-folder-to-dataroom-modal";
import { MoveToFolderModal } from "./move-folder-modal";

type FolderCardProps = {
  folder: FolderWithCount | FolderWithCountAndPath | DataroomFolderWithCount;
  teamInfo: TeamContextType | null;
  isDataroom?: boolean;
  dataroomId?: string;
  isDragging?: boolean;
  isOver?: boolean;
  isHovered?: boolean;
  isSelected?: boolean;
  onDelete?: (folderId: string) => void;
};

export default function FolderCard({
  folder,
  teamInfo,
  isDataroom,
  dataroomId,
  isDragging,
  isOver,
  isSelected,
  isHovered,
  onDelete,
}: FolderCardProps) {
  const router = useRouter();
  const queryParams = router.query;
  const searchQuery = queryParams["search"];
  const sortQuery = queryParams["sort"];
  const folderList = "folderList" in folder ? folder.folderList : undefined;
  const [moveFolderOpen, setMoveFolderOpen] = useState<boolean>(false);
  const [openFolder, setOpenFolder] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [addDataroomOpen, setAddDataroomOpen] = useState<boolean>(false);
  const [groupPermissionOpen, setGroupPermissionOpen] =
    useState<boolean>(false);
  const [downloadJobId, setDownloadJobId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Get hierarchical display name for dataroom folders
  const displayName = useHierarchicalDisplayName(
    folder.name,
    isDataroom && "hierarchicalIndex" in folder
      ? folder.hierarchicalIndex
      : undefined,
  );

  const folderPath =
    isDataroom && dataroomId
      ? `/datarooms/${dataroomId}/documents${folder.path}`
      : `/documents/tree${folder.path}`;
  const parentFolderPath = folder.path.substring(
    0,
    folder.path.lastIndexOf("/"),
  );

  // https://github.com/radix-ui/primitives/issues/1241#issuecomment-1888232392
  useEffect(() => {
    if (!openFolder || !addDataroomOpen) {
      setTimeout(() => {
        document.body.style.pointerEvents = "";
      });
    }
  }, [openFolder, addDataroomOpen]);

  const handleCreateDataroom = (e: any, folderId: string) => {
    e.stopPropagation();
    e.preventDefault();

    toast.promise(
      fetch(
        `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/create-from-folder`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            folderId: folderId,
          }),
        },
      ).then(async (response) => {
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.message || "An error occurred while creating dataroom.",
          );
        }
        return response.json();
      }),
      {
        loading: "Creating dataroom...",
        success: (data) => {
          toast.dismiss();
          setMenuOpen(false);
          mutate(`/api/teams/${teamInfo?.currentTeam?.id}/datarooms`);
          mutate(`/api/teams/${teamInfo?.currentTeam?.id}/datarooms?simple=true`);
          toast.success(`Successfully created!`, {
            description: `${folder.name} → ${data.name}`,
            action: {
              label: "Open Dataroom",
              onClick: () => router.push(`/datarooms/${data.id}/documents`),
            },
            duration: 10000,
          });
          return null;
        },
        error: (error) => {
          return error.message;
        },
      },
    );
  };

  const handleDownloadFolder = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);

    // The job is created before the modal opens, so an empty folder surfaces
    // as a toast instead of a modal that immediately shows an error.
    toast.promise(
      fetch(
        `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/download/bulk`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ folderId: folder.id }),
        },
      ).then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to start download");
        }
        setDownloadJobId(data.jobId);
      }),
      {
        loading: "Preparing download...",
        success: "Download started.",
        error: (err) => err.message || "Failed to download folder. Try again.",
      },
    );
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (isDragging || menuOpen) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    router.push(folderPath);
  };

  const handleHideFolder = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    toast.promise(
      fetch(`/api/teams/${teamInfo?.currentTeam?.id}/folders/hide`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          folderIds: [folder.id],
          hidden: true,
        }),
      }).then(async (res) => {
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to hide folder");
        }
        // Revalidate the folders and documents
        mutate(`/api/teams/${teamInfo?.currentTeam?.id}/folders?root=true`);
        mutate(`/api/teams/${teamInfo?.currentTeam?.id}/folders`);
        mutate(
          `/api/teams/${teamInfo?.currentTeam?.id}/folders${parentFolderPath}`,
        );
        mutate(`/api/teams/${teamInfo?.currentTeam?.id}/documents`);
        setMenuOpen(false);
      }),
      {
        loading: "Hiding folder from All Documents...",
        success: "Folder hidden from All Documents.",
        error: (err) => err.message || "Failed to hide folder. Try again.",
      },
    );
  };

  return (
    <>
      <div
        onClick={handleCardClick}
        className="group/row relative flex items-center justify-between rounded-lg border-0 bg-white p-3 ring-1 ring-gray-400 transition-all hover:bg-secondary hover:ring-gray-500 dark:bg-secondary dark:ring-gray-500 hover:dark:ring-gray-400 sm:p-4"
      >
        <div className="flex min-w-0 shrink items-center space-x-2 sm:space-x-4">
          {!isSelected && !isHovered ? (
            <div className="mx-0.5 flex w-8 items-center justify-center text-center sm:mx-1">
              {(() => {
                const FolderIconComponent = getFolderIcon(folder.icon);
                const colorClasses = getFolderColorClasses(folder.color);
                return (
                  <FolderIconComponent
                    className={`h-8 w-8 ${colorClasses.iconClass}`}
                    strokeWidth={1}
                  />
                );
              })()}
            </div>
          ) : (
            <div className="mx-0.5 w-8 sm:mx-1"></div>
          )}

          <div className="flex-col">
            <div className="flex items-center">
              <h2
                className="min-w-0 max-w-[150px] truncate text-sm font-semibold leading-6 text-foreground sm:max-w-md"
                style={HIERARCHICAL_DISPLAY_STYLE}
              >
                {displayName}
              </h2>
            </div>
            <div className="mt-1 flex items-center space-x-1 text-xs leading-5 text-muted-foreground">
              <p className="truncate">{timeAgo(folder.createdAt)}</p>
              <p>•</p>
              <p className="truncate">
                {folder._count.documents}{" "}
                {folder._count.documents === 1 ? "Document" : "Documents"}
              </p>
              <p>•</p>
              <p className="truncate">
                {folder._count.childFolders}{" "}
                {folder._count.childFolders === 1 ? "Folder" : "Folders"}
              </p>
            </div>
            {searchQuery && folderList !== undefined ? (
              <div className="relative z-10 mt-1 flex flex-wrap items-center space-x-1 text-xs leading-5 text-muted-foreground">
                {getBreadcrumbPath(folderList).map((segment, index) => (
                  <p
                    className="inset-2 flex items-center gap-x-1 truncate"
                    key={segment.pathLink}
                  >
                    {index !== 0 && <ChevronRight className="h-3 w-3" />}
                    <FolderIcon className="h-3 w-3" />
                    <Link
                      href={segment.pathLink}
                      onClick={(e) => e.stopPropagation()}
                      className="relative z-10 hover:underline"
                    >
                      {segment.name}
                    </Link>
                  </p>
                ))}
                <p className="inset-2 flex items-center gap-x-1 truncate">
                  <ChevronRight className="h-3 w-3" />
                  <FolderIcon className="h-3 w-3" />
                  <Link
                    href={folderPath}
                    onClick={(e) => e.stopPropagation()}
                    className="relative z-10 hover:underline"
                  >
                    {folder.name}
                  </Link>
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-row space-x-2">
          {/* <Link
          onClick={(e) => {
            e.stopPropagation();
          }}
          href={`/documents/${prismaDocument.id}`}
          className="flex items-center z-10 space-x-1 rounded-md bg-gray-200 dark:bg-gray-700 px-1.5 sm:px-2 py-0.5 transition-all duration-75 hover:scale-105 active:scale-100"
        >
          <BarChart className="w-3 h-3 sm:h-4 sm:w-4 text-muted-foreground" />
          <p className="text-xs whitespace-nowrap sm:text-sm text-muted-foreground">
            {nFormatter(prismaDocument._count.views)}
            <span className="hidden ml-1 sm:inline-block">views</span>
          </p>
        </Link> */}

          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                onClick={(e) => e.stopPropagation()}
                variant="outline"
                className="z-10 h-8 w-8 border-gray-200 bg-transparent p-0 hover:bg-gray-200 dark:border-gray-700 hover:dark:bg-gray-700 lg:h-9 lg:w-9"
              >
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" ref={dropdownRef} className="w-64">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpenFolder(true);
                }}
              >
                <FolderPenIcon className="mr-2 h-4 w-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMoveFolderOpen(true);
                }}
              >
                <FolderInputIcon className="mr-2 h-4 w-4" />
                Move to Folder
              </DropdownMenuItem>
              {!isDataroom ? (
                <DropdownMenuItem
                  onClick={(e) => handleCreateDataroom(e, folder.id)}
                >
                  <PackagePlusIcon className="mr-2 h-4 w-4" />
                  Create dataroom from folder
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setAddDataroomOpen(true);
                }}
              >
                <BetweenHorizontalStartIcon className="mr-2 h-4 w-4" />
                {isDataroom
                  ? "Copy folder to other dataroom"
                  : "Add folder to dataroom"}
              </DropdownMenuItem>
              {isDataroom && dataroomId ? (
                <>
                  <DropdownMenuItem onClick={handleDownloadFolder}>
                    <DownloadIcon className="mr-2 h-4 w-4" />
                    Download folder
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setGroupPermissionOpen(true);
                    }}
                  >
                    <FileSlidersIcon className="mr-2 h-4 w-4" />
                    Set Group Permissions
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigator.clipboard.writeText(folder.id);
                  toast.success("Folder ID copied to clipboard");
                }}
                className="group/folderid"
              >
                <CopyIcon className="mr-2 h-4 w-4" />
                <span className="inline group-hover/folderid:hidden">
                  Copy Folder ID
                </span>
                <span className="hidden group-hover/folderid:inline group-hover/folderid:cursor-copy">
                  {folder.id}
                </span>
              </DropdownMenuItem>
              {!isDataroom && (
                <DropdownMenuItem onClick={handleHideFolder}>
                  <EyeOffIcon className="mr-2 h-4 w-4" />
                  Hide from All Documents
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDelete?.(folder.id);
                  setMenuOpen(false);
                }}
                className="text-destructive duration-200 focus:bg-destructive focus:text-destructive-foreground"
              >
                <TrashIcon className="mr-2 h-4 w-4" />{" "}
                {isDataroom ? "Remove Folder" : "Delete Folder"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* only used for drag and drop */}
        {isOver && !isDragging && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black bg-opacity-20 dark:bg-white dark:bg-opacity-20">
            <span className="font-semibold text-black dark:text-gray-100">
              Drop to move
            </span>
          </div>
        )}
      </div>

      {openFolder ? (
        <EditFolderModal
          open={openFolder}
          setOpen={setOpenFolder}
          folderId={folder.id}
          name={folder.name}
          icon={folder.icon}
          color={folder.color}
          isDataroom={isDataroom}
          dataroomId={dataroomId}
        />
      ) : null}
      {addDataroomOpen ? (
        <AddFolderToDataroomModal
          open={addDataroomOpen}
          setOpen={setAddDataroomOpen}
          folderId={folder.id}
          folderName={folder.name}
          dataroomId={dataroomId}
        />
      ) : null}
      {moveFolderOpen && !isDataroom ? (
        <MoveToFolderModal
          open={moveFolderOpen}
          setOpen={setMoveFolderOpen}
          folderIds={[folder.id]}
          itemName={folder.name}
          documentIds={[]}
          folderParentId={folder.parentId!}
        />
      ) : null}
      {moveFolderOpen && isDataroom && dataroomId ? (
        <MoveToDataroomFolderModal
          open={moveFolderOpen}
          setOpen={setMoveFolderOpen}
          dataroomId={dataroomId}
          documentIds={[]}
          folderIds={[folder.id]}
          folderParentId={folder.parentId!}
          itemName={folder.name}
        />
      ) : null}
      {groupPermissionOpen && isDataroom && dataroomId ? (
        <SetUnifiedPermissionsModal
          open={groupPermissionOpen}
          setOpen={setGroupPermissionOpen}
          dataroomId={dataroomId}
          uploadedFiles={[
            {
              dataroomFolderId: folder.id,
              fileName: folder.name,
              itemType: "folder",
            },
          ]}
        />
      ) : null}
      {downloadJobId && dataroomId && teamInfo?.currentTeam?.id ? (
        <DownloadProgressModal
          isOpen
          onClose={() => setDownloadJobId(null)}
          jobId={downloadJobId}
          folderName={folder.name}
          teamId={teamInfo.currentTeam.id}
          dataroomId={dataroomId}
        />
      ) : null}
    </>
  );
}
