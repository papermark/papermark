import Link from "next/link";
import { useRouter } from "next/router";

import { useEffect, useRef, useState } from "react";

import { TeamContextType } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import {
  BetweenHorizontalStartIcon,
  ChevronRight,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  FolderIcon,
  FolderInputIcon,
  MoreVertical,
  ServerIcon,
  TrashIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { mutate } from "swr";

import useDataroomsSimple from "@/lib/swr/use-datarooms-simple";
import useLimits from "@/lib/swr/use-limits";
import { DocumentWithLinksAndLinkCountAndViewCount } from "@/lib/types";
import { cn, getBreadcrumbPath, nFormatter, timeAgo } from "@/lib/utils";
import { fileIcon } from "@/lib/utils/get-file-icon";
import { useCopyToClipboard } from "@/lib/utils/use-copy-to-clipboard";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { DataroomTrialModal } from "@/components/datarooms/dataroom-trial-modal";
import { AddToDataroomModal } from "@/components/documents/add-document-to-dataroom-modal";
import { DocumentPreviewModal } from "@/components/documents/document-preview-modal";
import { MoveToFolderModal } from "@/components/documents/move-folder-modal";
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
import { BadgeTooltip } from "@/components/ui/tooltip";

type DocumentsCardProps = {
  document: DocumentWithLinksAndLinkCountAndViewCount;
  teamInfo: TeamContextType | null;
  isDragging?: boolean;
  isSelected?: boolean;
  isHovered?: boolean;
};
export default function DocumentsCard({
  document: prismaDocument,
  teamInfo,
  isDragging,
  isSelected,
  isHovered,
}: DocumentsCardProps) {
  const router = useRouter();
  const queryParams = router.query;
  const searchQuery = queryParams["search"];
  const sortQuery = queryParams["sort"];
  const { theme, systemTheme } = useTheme();
  const isLight =
    theme === "light" || (theme === "system" && systemTheme === "light");

  const { isCopied, copyToClipboard } = useCopyToClipboard({});
  const [isFirstClick, setIsFirstClick] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [moveFolderOpen, setMoveFolderOpen] = useState<boolean>(false);
  const [addDataroomOpen, setAddDataroomOpen] = useState<boolean>(false);
  const [trialModalOpen, setTrialModalOpen] = useState<boolean>(false);
  const [planModalOpen, setPlanModalOpen] = useState<boolean>(false);
  const [previewOpen, setPreviewOpen] = useState<boolean>(false);

  const { datarooms } = useDataroomsSimple();

  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const { canAddDocuments } = useLimits();

  /** current folder name */
  const currentFolderPath = router.query.name as string[] | undefined;

  function handleCopyToClipboard(id: string) {
    copyToClipboard(
      `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${id}`,
      "Link copied to clipboard.",
    );
  }

  // https://github.com/radix-ui/primitives/issues/1241#issuecomment-1888232392
  useEffect(() => {
    if (!moveFolderOpen || !addDataroomOpen) {
      setTimeout(() => {
        document.body.style.pointerEvents = "";
      });
    }
  }, [moveFolderOpen, addDataroomOpen]);

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

    if (isFirstClick) {
      handleDeleteDocument(documentId);
      setIsFirstClick(false);
      setMenuOpen(false); // Close the dropdown after deleting
    } else {
      setIsFirstClick(true);
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    // Prevent the first click from deleting the document
    if (!isFirstClick) {
      setIsFirstClick(true);
      return;
    }

    const page = Number(queryParams["page"]) || 1;
    const pageSize = Number(queryParams["limit"]) || 10;

    const queryParts = [];
    if (searchQuery) queryParts.push(`query=${searchQuery}`);
    if (sortQuery) queryParts.push(`sort=${sortQuery}`);

    const paginationParams =
      searchQuery || sortQuery ? `&page=${page}&limit=${pageSize}` : "";
    if (paginationParams) queryParts.push(paginationParams.substring(1));
    const queryString = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";

    const endpoint = currentFolderPath
      ? `/folders/documents/${currentFolderPath.join("/")}`
      : `/documents${queryString}`;

    toast.promise(
      fetch(`/api/teams/${teamInfo?.currentTeam?.id}/documents/${documentId}`, {
        method: "DELETE",
      }).then(async (res) => {
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to delete document");
        }
        mutate(
          `/api/teams/${teamInfo?.currentTeam?.id}${endpoint}`,
          (currentData: any) => {
            if (!currentData) return currentData;

            if (Array.isArray(currentData)) {
              return currentData.filter(
                (doc: DocumentWithLinksAndLinkCountAndViewCount) =>
                  doc.id !== documentId,
              );
            } else if (currentData.documents) {
              return {
                ...currentData,
                documents: currentData.documents.filter(
                  (doc: DocumentWithLinksAndLinkCountAndViewCount) =>
                    doc.id !== documentId,
                ),
              };
            }
            return currentData;
          },
          {
            revalidate: false,
          },
        );
      }),
      {
        loading: "Deleting document...",
        success: "Document deleted successfully.",
        error: (err) => err.message || "Failed to delete document. Try again.",
      },
    );
  };

  const handleMenuStateChange = (open: boolean) => {
    // If the document is selected, don't open the dropdown
    if (isSelected) return;

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

  const handleDuplicateDocument = async (event: any) => {
    event.stopPropagation();
    event.preventDefault();

    toast.promise(
      fetch(
        `/api/teams/${teamInfo?.currentTeam?.id}/documents/${prismaDocument.id}/duplicate`,
        { method: "POST" },
      ).then(() => {
        mutate(`/api/teams/${teamInfo?.currentTeam?.id}/documents`);
        mutate(
          `/api/teams/${teamInfo?.currentTeam?.id}/folders/documents/${currentFolderPath?.join("/")}`,
        );
      }),
      {
        loading: "Duplicating document...",
        success: "Document duplicated successfully.",
        error: "Failed to duplicate document. Try again.",
      },
    );
  };

  const handleHideDocument = async (event: any) => {
    event.stopPropagation();
    event.preventDefault();

    const page = Number(queryParams["page"]) || 1;
    const pageSize = Number(queryParams["limit"]) || 10;

    const queryParts = [];
    if (searchQuery) queryParts.push(`query=${searchQuery}`);
    if (sortQuery) queryParts.push(`sort=${sortQuery}`);

    const paginationParams =
      searchQuery || sortQuery ? `&page=${page}&limit=${pageSize}` : "";
    if (paginationParams) queryParts.push(paginationParams.substring(1));
    const queryString = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";

    const endpoint = currentFolderPath
      ? `/folders/documents/${currentFolderPath.join("/")}`
      : `/documents${queryString}`;

    toast.promise(
      fetch(`/api/teams/${teamInfo?.currentTeam?.id}/documents/hide`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documentIds: [prismaDocument.id],
          hidden: true,
        }),
      }).then(async (res) => {
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to hide document");
        }
        mutate(
          `/api/teams/${teamInfo?.currentTeam?.id}${endpoint}`,
          (currentData: any) => {
            if (!currentData) return currentData;

            if (Array.isArray(currentData)) {
              return currentData.filter(
                (doc: DocumentWithLinksAndLinkCountAndViewCount) =>
                  doc.id !== prismaDocument.id,
              );
            } else if (currentData.documents) {
              return {
                ...currentData,
                documents: currentData.documents.filter(
                  (doc: DocumentWithLinksAndLinkCountAndViewCount) =>
                    doc.id !== prismaDocument.id,
                ),
              };
            }
            return currentData;
          },
          {
            revalidate: false,
          },
        );
        setMenuOpen(false);
      }),
      {
        loading: "Hiding document from All Documents...",
        success: "Document hidden from All Documents.",
        error: (err) =>
          err.message || "Failed to hide document. Try again.",
      },
    );
  };

  return (
    <>
      <div
        className={cn(
          "group/row relative flex items-center justify-between gap-x-2 rounded-lg border-0 bg-white p-3 ring-1 ring-gray-200 transition-all hover:bg-secondary hover:ring-gray-300 dark:bg-secondary dark:ring-gray-700 hover:dark:ring-gray-500 sm:p-4",
          isHovered && "bg-secondary ring-gray-300 dark:ring-gray-500",
        )}
      >
        <div className="flex min-w-0 flex-1 shrink items-center space-x-2 sm:space-x-4">
          {!isSelected && !isHovered ? (
            <div className="mx-0.5 flex w-8 shrink-0 items-center justify-center text-center sm:mx-1">
              {fileIcon({
                fileType: prismaDocument.type ?? "",
                className: "h-8 w-8",
                isLight,
              })}
            </div>
          ) : (
            <div className="mx-0.5 w-8 shrink-0 sm:mx-1"></div>
          )}

          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-w-0 items-center gap-1">
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold leading-6 text-foreground sm:max-w-none">
                <Link
                  href={`/documents/${prismaDocument.id}`}
                  className="relative block w-full min-w-0 truncate"
                >
                  <span className="block truncate">{prismaDocument.name}</span>
                  <span
                    className="absolute inset-0 z-0"
                    aria-hidden
                  />
                </Link>
              </h2>
              {prismaDocument._count.datarooms > 0 && (
                <div className="z-20 shrink-0">
                  <BadgeTooltip
                    content={`In ${prismaDocument._count.datarooms} dataroom${prismaDocument._count.datarooms > 1 ? "s" : ""}`}
                    key="dataroom"
                  >
                    <ServerIcon className="ml-2 h-4 w-4 text-[#fb7a00] hover:text-[#fb7a00]/90" />
                  </BadgeTooltip>
                </div>
              )}
            </div>
            <div className="mt-1 flex min-w-0 items-center space-x-1 overflow-hidden text-xs leading-5 text-muted-foreground">
              <p className="truncate">{timeAgo(prismaDocument.createdAt)}</p>
              <p>•</p>
              <p className="truncate">
                {prismaDocument._count.links}{" "}
                {prismaDocument._count.links === 1 ? "Link" : "Links"}
              </p>
              {prismaDocument._count.versions > 1 ? (
                <>
                  <p>•</p>
                  <p className="truncate">{`${prismaDocument._count.versions} Versions`}</p>
                </>
              ) : null}
            </div>
            {searchQuery || sortQuery ? (
              <div className="relative z-10 mt-1 flex flex-wrap items-center space-x-1 text-xs leading-5 text-muted-foreground">
                {getBreadcrumbPath(prismaDocument.folderList).map(
                  (segment, index) => (
                    <p
                      className="inset-2 flex items-center gap-x-1 truncate"
                      key={segment.pathLink}
                    >
                      {index !== 0 && <ChevronRight className="h-3 w-3" />}
                      <FolderIcon className="h-3 w-3" />
                      <Link
                        href={segment.pathLink}
                        className="relative z-10 hover:underline"
                      >
                        {segment.name}
                      </Link>
                    </p>
                  ),
                )}
                <p className="inset-2 flex items-center gap-x-1 truncate">
                  <ChevronRight className="h-3 w-3" />
                  <FileIcon className="h-3 w-3" />
                  <Link
                    href={`/documents/${prismaDocument.id}`}
                    className="relative z-10 hover:underline"
                  >
                    {prismaDocument.name}
                  </Link>
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-row space-x-2">
          <Link
            onClick={(e) => {
              e.stopPropagation();
            }}
            href={`/documents/${prismaDocument.id}`}
            className="z-20 flex shrink-0 items-center space-x-1 rounded-md bg-gray-200 px-1.5 py-0.5 transition-all duration-75 hover:scale-105 active:scale-100 dark:bg-gray-700 sm:px-2"
          >
            <BarChart className="h-3 w-3 text-muted-foreground sm:h-4 sm:w-4" />
            <p className="whitespace-nowrap text-xs text-muted-foreground sm:text-sm">
              {nFormatter(prismaDocument._count.views)}
              <span className="ml-1 hidden sm:inline-block">views</span>
            </p>
          </Link>

          <DropdownMenu open={menuOpen} onOpenChange={handleMenuStateChange}>
            <DropdownMenuTrigger asChild>
              <Button
                // size="icon"
                variant="outline"
                className="z-20 h-8 w-8 shrink-0 border-gray-200 bg-transparent p-0 hover:bg-gray-200 dark:border-gray-700 hover:dark:bg-gray-700 lg:h-9 lg:w-9"
              >
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" ref={dropdownRef}>
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => {
                  setPreviewOpen(true);
                  setMenuOpen(false);
                }}
              >
                <EyeIcon className="mr-2 h-4 w-4" />
                Quick preview
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setMoveFolderOpen(true)}>
                <FolderInputIcon className="mr-2 h-4 w-4" />
                Move to folder
              </DropdownMenuItem>
              {/* INFO: Duplicate document is disabled for now */}
              {/* <DropdownMenuItem
                onClick={(e) => handleDuplicateDocument(e)}
                disabled={!canAddDocuments}
              >
                <Layers2Icon className="mr-2 h-4 w-4" />
                Duplicate document
              </DropdownMenuItem> */}
              {datarooms && datarooms.length !== 0 && (
                <DropdownMenuItem onClick={() => setAddDataroomOpen(true)}>
                  <BetweenHorizontalStartIcon className="mr-2 h-4 w-4" />
                  Add to dataroom
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleHideDocument}>
                <EyeOffIcon className="mr-2 h-4 w-4" />
                Hide from All Documents
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(event) => handleButtonClick(event, prismaDocument.id)}
                className="text-destructive duration-200 focus:bg-destructive focus:text-destructive-foreground"
              >
                {isFirstClick ? (
                  "Really delete?"
                ) : (
                  <>
                    <TrashIcon className="mr-2 h-4 w-4" /> Delete document
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {moveFolderOpen ? (
        <MoveToFolderModal
          open={moveFolderOpen}
          setOpen={setMoveFolderOpen}
          documentIds={[prismaDocument.id]}
          itemName={prismaDocument.name}
          folderParentId={prismaDocument.folderId!}
        />
      ) : null}

      {addDataroomOpen ? (
        <AddToDataroomModal
          open={addDataroomOpen}
          setOpen={setAddDataroomOpen}
          documentId={prismaDocument.id}
          documentName={prismaDocument.name}
        />
      ) : null}

      {trialModalOpen ? (
        <DataroomTrialModal
          openModal={trialModalOpen}
          setOpenModal={setTrialModalOpen}
        />
      ) : null}
      {planModalOpen ? (
        <UpgradePlanModal
          clickedPlan={PlanEnum.DataRooms}
          trigger="datarooms"
          open={planModalOpen}
          setOpen={setPlanModalOpen}
        />
      ) : null}

      <DocumentPreviewModal
        documentId={prismaDocument.id}
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
}
