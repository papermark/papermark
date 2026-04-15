import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";

import { useEffect, useRef, useState } from "react";

import { TeamContextType } from "@/context/team-context";
import {
  ArchiveXIcon,
  BetweenHorizontalStartIcon,
  FilePenIcon,
  FileSlidersIcon,
  FolderInputIcon,
  MoreVertical,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { mutate } from "swr";

import { type DataroomFolderDocument } from "@/lib/swr/use-dataroom";
import { type DocumentWithLinksAndLinkCountAndViewCount } from "@/lib/types";
import { cn, nFormatter, timeAgo } from "@/lib/utils";
import { fileIcon } from "@/lib/utils/get-file-icon";
import {
  HIERARCHICAL_DISPLAY_STYLE,
  useHierarchicalDisplayName,
} from "@/lib/utils/hierarchical-display";

import BarChart from "@/components/shared/icons/bar-chart";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { AddToDataroomModal } from "../documents/add-document-to-dataroom-modal";
import { DocumentPreviewButton } from "../documents/document-preview-button";
import FileProcessStatusBar from "../documents/file-process-status-bar";
import { EditDataroomDocumentModal } from "./edit-dataroom-document-modal";
import { SetUnifiedPermissionsModal } from "./groups/set-unified-permissions-modal";
import { MoveToDataroomFolderModal } from "./move-dataroom-folder-modal";

type DocumentsCardProps = {
  document: DataroomFolderDocument;
  teamInfo: TeamContextType | null;
  dataroomId: string;
  isDragging?: boolean;
  isSelected?: boolean;
  isHovered?: boolean;
};
export default function DataroomDocumentCard({
  document: dataroomDocument,
  teamInfo,
  dataroomId,
  isDragging,
  isSelected,
  isHovered,
}: DocumentsCardProps) {
  const [groupPermissionOpen, setGroupPermissionOpen] =
    useState<boolean>(false);
  const { theme, systemTheme } = useTheme();
  const isLight =
    theme === "light" || (theme === "system" && systemTheme === "light");
  const router = useRouter();

  // Get hierarchical display name
  const displayName = useHierarchicalDisplayName(
    dataroomDocument.document.name,
    dataroomDocument.hierarchicalIndex,
  );

  const [isFirstClick, setIsFirstClick] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [moveFolderOpen, setMoveFolderOpen] = useState<boolean>(false);
  const [renameOpen, setRenameOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [addDataRoomOpen, setAddDataRoomOpen] = useState<boolean>(false);

  /** current folder name */
  const currentFolderPath = router.query.name as string[] | undefined;

  // Add state for document processing status
  const [isProcessing, setIsProcessing] = useState(false);

  // https://github.com/radix-ui/primitives/issues/1241#issuecomment-1888232392
  useEffect(() => {
    if (!moveFolderOpen) {
      setTimeout(() => {
        document.body.style.pointerEvents = "";
      });
    }
  }, [moveFolderOpen]);

  useEffect(() => {
    if (!renameOpen) {
      setTimeout(() => {
        document.body.style.pointerEvents = "";
      });
    }
  }, [renameOpen]);

  useEffect(() => {
    function handleClickOutside(event: { target: any }) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setMenuOpen(false);
        setIsFirstClick(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleButtonClick = (event: any, documentId: string) => {
    event.stopPropagation();
    event.preventDefault();

    console.log("isFirstClick", isFirstClick);
    if (isFirstClick) {
      handleRemoveDocument(documentId);
      setIsFirstClick(false);
      setMenuOpen(false); // Close the dropdown after deleting
    } else {
      setIsFirstClick(true);
    }
  };

  const handleRemoveDocument = async (documentId: string) => {
    // Prevent the first click from deleting the document
    if (!isFirstClick) {
      setIsFirstClick(true);
      return;
    }

    const endpoint = currentFolderPath
      ? `/folders/documents/${currentFolderPath.join("/")}`
      : "/documents";

    toast.promise(
      fetch(
        `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/documents/${documentId}`,
        {
          method: "DELETE",
        },
      ).then(async (res) => {
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to remove document");
        }
        mutate(
          `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}${endpoint}`,
          null,
          {
            populateCache: (_, docs) => {
              return docs.filter(
                (doc: DocumentWithLinksAndLinkCountAndViewCount) =>
                  doc.id !== documentId,
              );
            },
            revalidate: false,
          },
        );
      }),
      {
        loading: "Removing document...",
        success: "Document removed successfully.",
        error: (err) => err.message || "Failed to remove document. Try again.",
      },
    );
  };

  const handleMenuStateChange = (open: boolean) => {
    if (isFirstClick) {
      setMenuOpen(true); // Keep the dropdown open on the first click
      return;
    }

    // If the menu is closed, reset the isFirstClick state
    if (!open) {
      setIsFirstClick(false);
      setMenuOpen(false); // Ensure the dropdown is closed
    } else {
      setMenuOpen(true); // Open the dropdown
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (isDragging || menuOpen) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    router.push(`/documents/${dataroomDocument.document.id}`);
  };

  return (
    <>
      <div
        onClick={handleCardClick}
        className={cn(
          "group/row relative flex flex-col rounded-lg border-0 bg-white ring-1 ring-gray-200 transition-all hover:bg-secondary hover:ring-gray-300 dark:bg-secondary dark:ring-gray-700 hover:dark:ring-gray-500",
          isDragging ? "cursor-grabbing" : "cursor-pointer",
          isHovered && "bg-secondary ring-gray-300 dark:ring-gray-500",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-between p-3 sm:p-4",
            isProcessing && "opacity-60",
          )}
        >
          <div className="flex min-w-0 flex-1 shrink items-center space-x-2 sm:space-x-4">
            {!isSelected && !isHovered ? (
              <div className="mx-0.5 flex w-8 shrink-0 items-center justify-center text-center sm:mx-1">
                {fileIcon({
                  fileType: dataroomDocument.document.type ?? "",
                  className: "h-8 w-8",
                  isLight,
                })}
              </div>
            ) : (
              <div className="mx-0.5 w-8 shrink-0 sm:mx-1"></div>
            )}

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-w-0 items-center">
                <h2
                  className="min-w-0 flex-1 truncate text-sm font-semibold leading-6 text-foreground sm:max-w-none"
                  style={HIERARCHICAL_DISPLAY_STYLE}
                >
                  {displayName}
                </h2>
              </div>
              <div className="mt-1 flex min-w-0 items-center space-x-1 overflow-hidden text-xs leading-5 text-muted-foreground">
                <p className="truncate">
                  {timeAgo(dataroomDocument.createdAt)}
                </p>
                {dataroomDocument.document._count.versions > 1 ? (
                  <>
                    <p>•</p>
                    <p className="truncate">{`${dataroomDocument.document._count.versions} Versions`}</p>
                  </>
                ) : null}
                {dataroomDocument.document.isExternalUpload ? (
                  <>
                    <p>•</p>
                    <p className="truncate">Added by external collaborator</p>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-row space-x-2">
            <Link
              onClick={(e) => {
                e.stopPropagation();
              }}
              href={`/documents/${dataroomDocument.document.id}`}
              className="z-10 flex shrink-0 items-center space-x-1 rounded-md bg-gray-200 px-1.5 py-0.5 transition-all duration-75 hover:scale-105 active:scale-100 dark:bg-gray-700 sm:px-2"
            >
              <BarChart className="h-3 w-3 text-muted-foreground sm:h-4 sm:w-4" />
              <p className="whitespace-nowrap text-xs text-muted-foreground sm:text-sm">
                {nFormatter(dataroomDocument.document._count.views)}
                <span className="ml-1 hidden sm:inline-block">views</span>
              </p>
            </Link>

            <DocumentPreviewButton
              documentId={dataroomDocument.document.id}
              primaryVersion={{
                hasPages:
                  dataroomDocument.document.versions?.[0]?.hasPages || false,
                type: dataroomDocument.document.type,
                numPages: null,
              }}
              advancedExcelEnabled={
                dataroomDocument.document.advancedExcelEnabled
              }
              variant="outline"
              size="icon"
              className="z-10 h-8 w-8 shrink-0 border-gray-200 bg-transparent hover:bg-gray-200 dark:border-gray-700 hover:dark:bg-gray-700 lg:h-9 lg:w-9"
            />

            <DropdownMenu open={menuOpen} onOpenChange={handleMenuStateChange}>
              <DropdownMenuTrigger asChild>
                <Button
                  onClick={(e) => e.stopPropagation()}
                  variant="outline"
                  className="z-10 h-8 w-8 shrink-0 border-gray-200 bg-transparent p-0 hover:bg-gray-200 dark:border-gray-700 hover:dark:bg-gray-700 lg:h-9 lg:w-9"
                >
                  <span className="sr-only">Open menu</span>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" ref={dropdownRef}>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenameOpen(true);
                  }}
                >
                  <FilePenIcon className="mr-2 h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    setMoveFolderOpen(true);
                  }}
                >
                  <FolderInputIcon className="mr-2 h-4 w-4" />
                  Move to folder
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddDataRoomOpen(true);
                  }}
                >
                  <BetweenHorizontalStartIcon className="mr-2 h-4 w-4" />
                  Copy to other dataroom
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    setGroupPermissionOpen(true);
                  }}
                >
                  <FileSlidersIcon className="mr-2 h-4 w-4" />
                  Set Group Permissions
                </DropdownMenuItem>
                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={(event) =>
                    handleButtonClick(event, dataroomDocument.id)
                  }
                  className="text-destructive duration-200 focus:bg-destructive focus:text-destructive-foreground"
                >
                  {isFirstClick ? (
                    "Really remove?"
                  ) : (
                    <>
                      <ArchiveXIcon className="mr-2 h-4 w-4" /> Remove document
                    </>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {["pdf", "docs", "slides", "cad"].includes(
          dataroomDocument.document.type,
        ) &&
          !dataroomDocument.document.versions?.[0]?.hasPages &&
          dataroomDocument.document.versions?.[0]?.id && (
            <FileProcessStatusBar
              documentVersionId={dataroomDocument.document.versions[0].id}
              className="rounded-b-lg border-t border-gray-200 dark:border-gray-700"
              mutateDocument={() => {
                setIsProcessing(false);
                mutate(
                  `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/documents`,
                );
              }}
              onProcessingChange={(processing) => setIsProcessing(processing)}
            />
          )}
      </div>
      {renameOpen ? (
        <EditDataroomDocumentModal
          open={renameOpen}
          setOpen={setRenameOpen}
          documentId={dataroomDocument.document.id}
          documentName={dataroomDocument.document.name}
          dataroomId={dataroomId}
        />
      ) : null}
      {addDataRoomOpen ? (
        <AddToDataroomModal
          open={addDataRoomOpen}
          setOpen={setAddDataRoomOpen}
          documentId={dataroomDocument.document.id}
          documentName={dataroomDocument.document.name}
          dataroomId={dataroomId}
        />
      ) : null}
      {moveFolderOpen ? (
        <MoveToDataroomFolderModal
          open={moveFolderOpen}
          setOpen={setMoveFolderOpen}
          dataroomId={dataroomDocument.dataroomId}
          documentIds={[dataroomDocument.id]}
          itemName={dataroomDocument.document.name}
          folderIds={[]}
        />
      ) : null}
      {groupPermissionOpen ? (
        <SetUnifiedPermissionsModal
          open={groupPermissionOpen}
          setOpen={setGroupPermissionOpen}
          dataroomId={dataroomId}
          uploadedFiles={[
            {
              documentId: dataroomDocument.id,
              dataroomDocumentId: dataroomDocument.id,
              fileName: dataroomDocument.document.name,
            },
          ]}
        />
      ) : null}
    </>
  );
}
