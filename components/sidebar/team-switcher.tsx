"use client";

import * as React from "react";

import { useLimits } from "@/ee/limits/swr-handler";
import { PlanEnum } from "@/ee/stripe/constants";
import { ChevronsUpDown, UserRoundPlusIcon } from "lucide-react";
import { usePlan } from "@/lib/swr/use-billing";
import { Team } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

import { AddSeatModal } from "../billing/add-seat-modal";
import { UpgradePlanModal } from "../billing/upgrade-plan-modal";
import { AddTeamMembers } from "../teams/add-team-member-modal";
import { AddTeamModal } from "../teams/add-team-modal";
import { Avatar, AvatarFallback } from "../ui/avatar";

export function TeamSwitcher({
  currentTeam: activeTeam,
  teams,
  setCurrentTeam,
}: {
  currentTeam: Team | null;
  teams: Team[];
  setCurrentTeam: (team: Team) => void;
}) {
  const [isTeamMemberInviteModalOpen, setTeamMemberInviteModalOpen] =
    React.useState<boolean>(false);
  const [isAddSeatModalOpen, setAddSeatModalOpen] =
    React.useState<boolean>(false);
  const { isMobile } = useSidebar();
  const { canAddUsers, showUpgradePlanModal } = useLimits();
  const { isTrial, isDataroomsPremium } = usePlan();

  const switchTeam = (team: Team) => {
    localStorage.setItem("currentTeamId", team.id);
    setCurrentTeam(team);
  };

  if (!activeTeam) return null;

  return (
    <SidebarMenu className="flex flex-row items-center gap-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5">
      <SidebarMenuItem className="w-full">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="border data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded">
                <AvatarFallback className="rounded">
                  {activeTeam?.name?.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate">{activeTeam.name}</span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Teams
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {teams.map((team, index) => (
              <DropdownMenuItem
                key={index}
                onClick={() => switchTeam(team)}
                className={cn(
                  "gap-2 p-2",
                  team.id === activeTeam.id && "bg-muted font-medium",
                )}
              >
                {/* <div className="flex size-6 items-center justify-center rounded-sm border">
                  <GalleryVerticalEndIcon className="size-4 shrink-0" />
                </div> */}
                <Avatar className="size-6 shrink-0 rounded text-[12px]">
                  <AvatarFallback className="rounded">
                    {team?.name?.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {team.name}
                {/* <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut> */}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {isDataroomsPremium ? (
              <AddTeamModal setCurrentTeam={setCurrentTeam}>
                <DropdownMenuItem
                  className="gap-2 p-2 cursor-pointer"
                  onSelect={(e) => e.preventDefault()}
                >
                  <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                    <UserRoundPlusIcon className="size-4" />
                  </div>
                  <div className="font-medium text-muted-foreground">Add new team</div>
                </DropdownMenuItem>
              </AddTeamModal>
            ) : (
              <UpgradePlanModal
                clickedPlan={PlanEnum.DataRoomsPremium}
                trigger="add_new_team"
                highlightItem={["teams"]}
              >
                <DropdownMenuItem
                  className="gap-2 p-2 cursor-pointer"
                  onSelect={(e) => e.preventDefault()}
                >
                  <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                    <UserRoundPlusIcon className="size-4" />
                  </div>
                  <div className="font-medium text-muted-foreground">Add new team</div>
                </DropdownMenuItem>
              </UpgradePlanModal>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <SidebarMenuItem>
        {showUpgradePlanModal ? (
          <UpgradePlanModal
            clickedPlan={PlanEnum.Business}
            trigger={"invite_team_members"}
            highlightItem={["users"]}
          >
            <SidebarMenuButton
              size="lg"
              className="size-12 justify-center border data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden"
            >
              <UserRoundPlusIcon className="!size-5" strokeWidth={1.5} />
            </SidebarMenuButton>
          </UpgradePlanModal>
        ) : canAddUsers ? (
          <AddTeamMembers
            open={isTeamMemberInviteModalOpen}
            setOpen={setTeamMemberInviteModalOpen}
          >
            <SidebarMenuButton
              size="lg"
              className="size-12 justify-center border data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden"
            >
              <UserRoundPlusIcon className="!size-5" strokeWidth={1.5} />
            </SidebarMenuButton>
          </AddTeamMembers>
        ) : (
          <AddSeatModal open={isAddSeatModalOpen} setOpen={setAddSeatModalOpen}>
            <SidebarMenuButton
              size="lg"
              className="size-12 justify-center border data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden"
            >
              <UserRoundPlusIcon className="!size-5" strokeWidth={1.5} />
            </SidebarMenuButton>
          </AddSeatModal>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
