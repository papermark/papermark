import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { useUninvitedMembers } from "@/ee/features/dataroom-invitations/lib/swr/use-dataroom-invitations";
import {
  MailCheckIcon,
  MoreHorizontalIcon,
  PlusCircleIcon,
  SendIcon,
  UserXIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import { usePlan } from "@/lib/swr/use-billing";
import { useDataroom } from "@/lib/swr/use-dataroom";
import { useDataroomGroup } from "@/lib/swr/use-dataroom-groups";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimestampTooltip } from "@/components/ui/timestamp-tooltip";
import { VisitorAvatar } from "@/components/visitors/visitor-avatar";

import { InviteViewersModal } from "../../../ee/features/dataroom-invitations/components/invite-viewers-modal";
import { AddGroupMemberModal } from "./add-member-modal";

export default function GroupMemberTable({
  dataroomId,
  groupId,
}: {
  dataroomId: string;
  groupId: string;
}) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { dataroom } = useDataroom();
  const { viewerGroupMembers, viewerGroupDomains, viewerGroupAllowAll } =
    useDataroomGroup();
  const {
    uninvitedCount,
    uninvitedEmails,
    mutate: mutateUninvited,
  } = useUninvitedMembers(dataroomId, groupId);
  const { isDataroomsPlus } = usePlan();
  const canInviteViewers = isDataroomsPlus;

  const [addMembersOpen, setAddMembersOpen] = useState<boolean>(false);
  const [inviteOpen, setInviteOpen] = useState<boolean>(false);

  const groupKey = teamId
    ? `/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}`
    : null;

  const handleToggleAllowAll = async () => {
    const key =
      groupKey ??
      `/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}`;
    const response = await fetch(
      `/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          allowAll: !viewerGroupAllowAll,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      mutate(key);
      toast.error("Failed to update group settings");
      return;
    }
    mutate(key);
    toast.success(
      viewerGroupAllowAll
        ? "Group access restricted to specific members and domains"
        : "Group now allows access from any email",
    );
  };

  const handleRemoveDomain = async (domain: string) => {
    const key =
      groupKey ??
      `/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}`;
    const response = await fetch(
      `/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          domains: viewerGroupDomains.filter((d) => d !== domain),
        }),
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      mutate(key);
      toast.error("Failed to remove domain");
      return;
    }
    mutate(key);
    toast.success("Domain removed successfully");
  };

  const handleRemoveMember = async (id: string) => {
    // mutate the data optimistically
    const key =
      groupKey ??
      `/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}`;
    mutate(
      key,
      (currentData: { members: any[] } | undefined) => {
        if (!currentData) return currentData;
        return {
          ...currentData,
          viewerGroupMembers: currentData.members.filter(
            (member) => member.id !== id,
          ),
        };
      },
      false,
    );

    const response = await fetch(
      `/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}/members/${id}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      mutate(key);
      toast.error("Failed to remove member");
      return;
    }
    mutate(key);
    toast.success("Member removed successfully");
  };

  return (
    <>
      <div className="l">
        <div className="mb-2 flex items-center justify-between md:mb-4">
          <h2>All members</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                checked={viewerGroupAllowAll}
                onCheckedChange={handleToggleAllowAll}
                aria-label="Allow all emails"
              />
              <span className="text-sm text-muted-foreground">
                Allow all emails
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => setAddMembersOpen(true)}
                className="h-8 gap-1"
                disabled={viewerGroupAllowAll}
              >
                <PlusCircleIcon className="h-4 w-4" />
                Add members
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setInviteOpen(true)}
                className="relative h-8 gap-1"
              >
                <SendIcon className="h-4 w-4" />
                Invite via email
                {canInviteViewers && uninvitedCount > 0 ? (
                  <Badge
                    variant="notification"
                    className="ml-1"
                  >
                    {uninvitedCount}
                  </Badge>
                ) : null}
              </Button>
            </div>
          </div>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="*:whitespace-nowrap *:font-medium hover:bg-transparent">
                <TableHead>Name</TableHead>
                {/* <TableHead>Visit Duration</TableHead> */}
                {/* <TableHead>Last Viewed Document</TableHead> */}
                {/* <TableHead>Last Viewed</TableHead> */}
                <TableHead className="text-center"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {viewerGroupAllowAll ? (
                <TableRow>
                  <TableCell colSpan={2}>
                    <div className="flex h-40 w-full items-center justify-center">
                      <p className="text-sm text-muted-foreground">
                        All email addresses are allowed to access this group
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : viewerGroupMembers.length === 0 &&
                viewerGroupDomains.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2}>
                    <div className="flex h-40 w-full items-center justify-center">
                      <p>No views yet. Try sharing a link.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {viewerGroupDomains.length > 0 &&
                    viewerGroupDomains.map((domain) => (
                      <TableRow key={domain} className="group/row">
                        <TableCell className="">
                          <div className="flex items-center overflow-visible sm:space-x-3">
                            <VisitorAvatar viewerEmail={"@"} />
                            <div className="min-w-0 flex-1">
                              <div className="focus:outline-none">
                                <p className="flex items-center gap-x-2 overflow-visible text-sm font-medium text-gray-800 dark:text-gray-200">
                                  {domain}
                                </p>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        {/* Actions */}
                        <TableCell className="p-0 text-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                className="h-8 w-8 p-0 group-hover/row:ring-1 group-hover/row:ring-gray-200 group-hover/row:dark:ring-gray-700"
                              >
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontalIcon className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="gap-x-2 text-destructive focus:bg-destructive focus:text-destructive-foreground"
                                onClick={() => handleRemoveDomain(domain)}
                              >
                                <XIcon className="h-4 w-4" />
                                Remove Domain
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  {viewerGroupMembers ? (
                    viewerGroupMembers.map((viewer) => {
                      const latestInvitation = viewer.viewer.invitations?.[0];
                      return (
                        <TableRow key={viewer.id} className="group/row">
                          {/* Name */}
                          <TableCell className="">
                            <div className="flex items-center overflow-visible sm:space-x-3">
                              <VisitorAvatar
                                viewerEmail={viewer.viewer.email}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="focus:outline-none">
                                  <p className="flex items-center gap-x-2 overflow-visible text-sm font-medium text-gray-800 dark:text-gray-200">
                                    {viewer.viewer.email}
                                    {latestInvitation && (
                                      <TimestampTooltip
                                        timestamp={latestInvitation.sentAt}
                                        side="right"
                                        rows={["local", "utc"]}
                                      >
                                        <MailCheckIcon className="h-4 w-4 text-blue-500 hover:text-blue-600" />
                                      </TimestampTooltip>
                                    )}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          {/* Last Viewed */}
                          {/* <TableCell className="text-sm text-muted-foreground">
                        <time
                          dateTime={new Date(viewer.viewer.updatedAt).toISOString()}
                        >
                          {viewer.viewer.updatedAt
                            ? timeAgo(viewer.viewer.updatedAt)
                            : "-"}
                        </time>
                      </TableCell> */}
                          {/* Actions */}
                          <TableCell className="p-0 text-center">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  className="h-8 w-8 p-0 group-hover/row:ring-1 group-hover/row:ring-gray-200 group-hover/row:dark:ring-gray-700"
                                >
                                  <span className="sr-only">Open menu</span>
                                  <MoreHorizontalIcon className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="gap-x-2 text-destructive focus:bg-destructive focus:text-destructive-foreground"
                                  onClick={() => handleRemoveMember(viewer.id)}
                                >
                                  <UserXIcon className="h-4 w-4" />
                                  Remove Member
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell className="min-w-[100px]">
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-6 w-24" />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <AddGroupMemberModal
        dataroomId={dataroomId}
        groupId={groupId}
        open={addMembersOpen}
        setOpen={setAddMembersOpen}
      />
      <InviteViewersModal
        open={inviteOpen}
        setOpen={(next) => {
          setInviteOpen(next);
          if (!next) {
            mutateUninvited();
          }
        }}
        dataroomId={dataroomId}
        dataroomName={dataroom?.name ?? "this dataroom"}
        groupId={groupId}
        defaultEmails={uninvitedEmails}
        canSend={canInviteViewers}
        onSuccess={() => {
          if (groupKey) {
            mutate(groupKey);
            }
            mutateUninvited();
          }}
        />
    </>
  );
}
