import { useRouter } from "next/router";

import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { ViewerGroup } from "@prisma/client";
import { BoxesIcon, Layers2Icon, Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import BarChart from "@/components/shared/icons/bar-chart";
import MoreVertical from "@/components/shared/icons/more-vertical";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useAnalytics } from "@/lib/analytics";
import useDataroomGroups from "@/lib/swr/use-dataroom-groups";
import { cn, nFormatter } from "@/lib/utils";

export default function GroupCard({
  group,
  dataroomId,
}: {
  group: ViewerGroup & { _count: { members: number; views: number } };
  dataroomId: string;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);

  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const analytics = useAnalytics();
  const { mutate: mutateGroups } = useDataroomGroups({ dataroomId });

  // Stop link navigation when interacting with the dropdown trigger or items.
  const stopNavigation = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDeleteNavigation = (event: React.MouseEvent) => {
    stopNavigation(event);
    setMenuOpen(false);
    router.push(`/datarooms/${dataroomId}/groups/${group.id}#delete-group`);
  };

  const handleDuplicate = async (event: React.MouseEvent) => {
    stopNavigation(event);
    if (isDuplicating || !teamId) return;

    setIsDuplicating(true);
    try {
      const response = await fetch(
        `/api/teams/${teamId}/datarooms/${dataroomId}/groups/${group.id}/duplicate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );

      if (!response.ok) {
        let message = "Failed to duplicate group. Please try again.";
        try {
          const data = await response.json();
          message = data?.message || data?.error || message;
        } catch {
          // ignore body parse errors
        }
        toast.error(message);
        return;
      }

      analytics.capture("Group Duplicated", {
        groupId: group.id,
        dataroomId,
      });
      toast.success("Group duplicated successfully.");
      await mutateGroups();
    } catch (error) {
      console.error("Error duplicating group:", error);
      toast.error("Failed to duplicate group. Please try again.");
    } finally {
      setIsDuplicating(false);
      setMenuOpen(false);
    }
  };

  return (
    <>
      <div className="hover:drop-shadow-card-hover group rounded-xl border border-gray-200 bg-white p-4 transition-[filter] dark:bg-gray-800 sm:p-5">
        <div className="flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="hidden rounded-full border border-gray-200 sm:block">
              <div
                className={cn(
                  "rounded-full border border-white bg-gradient-to-t from-gray-100 p-1 md:p-3",
                )}
              >
                <BoxesIcon className="size-5" />
              </div>
            </div>
            <div className="overflow-hidden">
              <div className="flex flex-col gap-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {group.name}
                </p>
                <span className="text-xs text-muted-foreground">
                  {group._count.members} members
                </span>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 sm:gap-3">
            <div className="z-20 flex items-center space-x-1 rounded-md bg-gray-200 px-1.5 py-0.5 transition-all duration-75 hover:scale-105 active:scale-100 dark:bg-gray-700 sm:px-2">
              <BarChart className="h-3 w-3 text-muted-foreground sm:h-4 sm:w-4" />
              <p className="whitespace-nowrap text-xs text-muted-foreground sm:text-sm">
                {nFormatter(group._count.views)}
                <span className="ml-1 hidden sm:inline-block">views</span>
              </p>
            </div>

            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="z-20 h-8 w-8 border-gray-200 bg-transparent p-0 hover:bg-gray-200 dark:border-gray-700 hover:dark:bg-gray-700 lg:h-9 lg:w-9"
                  onClick={stopNavigation}
                >
                  <span className="sr-only">Open menu</span>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onClick={(event) => event.stopPropagation()}
              >
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={isDuplicating}
                  onSelect={(event) => {
                    event.preventDefault();
                  }}
                  onClick={handleDuplicate}
                >
                  {isDuplicating ? (
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Layers2Icon className="mr-2 h-4 w-4" />
                  )}
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                  }}
                  onClick={handleDeleteNavigation}
                  className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
                >
                  <Trash2Icon className="mr-2 h-4 w-4" />
                  Delete group
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </>
  );
}
