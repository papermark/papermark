import Link from "next/link";

import { useEffect, useRef, useState } from "react";

import { TeamContextType } from "@/context/team-context";
import {
  EyeIcon,
  MoreVertical,
  ServerIcon,
  TrashIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { mutate } from "swr";

import { DocumentWithLinksAndLinkCountAndViewCount } from "@/lib/types";
import { cn, nFormatter, timeAgo } from "@/lib/utils";
import { fileIcon } from "@/lib/utils/get-file-icon";

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
import { Checkbox } from "@/components/ui/checkbox";
import { BadgeTooltip } from "@/components/ui/tooltip";

type HiddenDocumentCardProps = {
  document: DocumentWithLinksAndLinkCountAndViewCount;
  teamInfo: TeamContextType | null;
  isSelected?: boolean;
  onSelect?: () => void;
};

export function HiddenDocumentCard({
  document: prismaDocument,
  teamInfo,
  isSelected,
  onSelect,
}: HiddenDocumentCardProps) {
  const { theme, systemTheme } = useTheme();
  const isLight =
    theme === "light" || (theme === "system" && systemTheme === "light");

  const [isFirstClick, setIsFirstClick] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [isHovered, setIsHovered] = useState<boolean>(false);

  const dropdownRef = useRef<HTMLDivElement | null>(null);

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
      setMenuOpen(false);
    } else {
      setIsFirstClick(true);
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    if (!isFirstClick) {
      setIsFirstClick(true);
      return;
    }

    const teamId = teamInfo?.currentTeam?.id;
    if (!teamId) {
      toast.error("Team information is missing. Please try again.");
      return;
    }

    toast.promise(
      fetch(`/api/teams/${teamId}/documents/${documentId}`, {
        method: "DELETE",
      }).then(async (res) => {
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to delete document");
        }
        mutate(`/api/teams/${teamId}/documents/hidden`);
      }),
      {
        loading: "Deleting document...",
        success: "Document deleted successfully.",
        error: (err) => err.message || "Failed to delete document. Try again.",
      },
    );
  };

  const handleMenuStateChange = (open: boolean) => {
    if (isSelected) return;

    if (isFirstClick) {
      setMenuOpen(true);
      return;
    }

    if (!open) {
      setIsFirstClick(false);
      setMenuOpen(false);
    } else {
      setMenuOpen(true);
    }
  };

  const handleUnhideDocument = async (event: any) => {
    event.stopPropagation();
    event.preventDefault();

    const teamId = teamInfo?.currentTeam?.id;
    if (!teamId) {
      toast.error("Team information is missing. Please try again.");
      return;
    }

    toast.promise(
      fetch(`/api/teams/${teamId}/documents/hide`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documentIds: [prismaDocument.id],
          hidden: false,
        }),
      }).then(async (res) => {
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to unhide document");
        }
        mutate(`/api/teams/${teamId}/documents/hidden`);
        mutate(`/api/teams/${teamId}/documents`);
        mutate(`/api/teams/${teamId}/folders?root=true`);
        setMenuOpen(false);
      }),
      {
        loading: "Unhiding document...",
        success: "Document is now visible in All Documents.",
        error: (err) =>
          err.message || "Failed to unhide document. Try again.",
      },
    );
  };

  return (
    <div
      className={cn(
        "group/row relative flex items-center justify-between gap-x-2 rounded-lg border-0 bg-white p-3 ring-1 ring-gray-200 transition-all hover:bg-secondary hover:ring-gray-300 dark:bg-secondary dark:ring-gray-700 hover:dark:ring-gray-500 sm:p-4",
        isHovered && "bg-secondary ring-gray-300 dark:ring-gray-500",
        isSelected && "ring-2 ring-primary",
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex min-w-0 flex-1 shrink items-center space-x-2 sm:space-x-4">
        {isSelected || isHovered ? (
          <div
            className="mx-0.5 flex w-8 shrink-0 items-center justify-center sm:mx-1"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect?.();
            }}
          >
            <Checkbox
              checked={isSelected}
              className="h-5 w-5"
              aria-label={isSelected ? "Deselect document" : "Select document"}
            />
          </div>
        ) : (
          <div className="mx-0.5 flex w-8 shrink-0 items-center justify-center text-center sm:mx-1">
            {fileIcon({
              fileType: prismaDocument.type ?? "",
              className: "h-8 w-8",
              isLight,
            })}
          </div>
        )}

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-w-0 items-center gap-1">
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold leading-6 text-foreground sm:max-w-none">
              <Link
                href={`/documents/${prismaDocument.id}`}
                className="relative block w-full min-w-0 truncate"
              >
                <span className="block truncate">{prismaDocument.name}</span>
                <span className="absolute inset-0 z-0" aria-hidden />
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
              variant="outline"
              className="z-20 h-8 w-8 shrink-0 border-gray-200 bg-transparent p-0 hover:bg-gray-200 dark:border-gray-700 hover:dark:bg-gray-700 lg:h-9 lg:w-9"
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" ref={dropdownRef}>
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem onClick={handleUnhideDocument}>
              <EyeIcon className="mr-2 h-4 w-4" />
              Show in All Documents
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
  );
}
