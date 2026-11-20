import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import {
  CircleHelpIcon,
  MoreHorizontalIcon,
  UserMinusIcon,
  XCircleIcon,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { mutate } from "swr";

import { useSelfMembership } from "@/lib/hooks/use-self-membership";
import { usePlan } from "@/lib/swr/use-billing";
import { useDataroomMembers } from "@/lib/swr/use-dataroom-members";
import useLimits from "@/lib/swr/use-limits";
import { CustomUser, TeamRole } from "@/lib/types";
import { generateGravatarHash } from "@/lib/utils";

import { AddSeatModal } from "@/components/billing/add-seat-modal";
import { AddTeamMembers } from "@/components/teams/add-team-member-modal";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BadgeTooltip } from "@/components/ui/tooltip";
import { UpgradeButton } from "@/components/ui/upgrade-button";

const ROLE_LABELS: Record<TeamRole, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  MEMBER: "Member",
  DATAROOM_MEMBER: "Data room member",
};

export default function DataroomTeamMembers({
  dataroomId,
  dataroomName,
}: {
  dataroomId: string;
  dataroomName?: string;
}) {
  const { currentTeamId } = useTeam();
  const {
    members,
    invitations,
    loading,
    mutate: mutateMembers,
  } = useDataroomMembers(dataroomId);
  const { data: session } = useSession();
  const { role } = useSelfMembership();
  const { isDataroomsUnlimited } = usePlan();
  const { canAddUsers, showUpgradePlanModal, limits } = useLimits();
  const canManage = role === "ADMIN" || role === "MANAGER";
  // Inviting goes through the team invite endpoint, which is admin-only.
  const canInvite = role === "ADMIN";
  const seatsUnlimited =
    isDataroomsUnlimited ||
    limits?.users === null ||
    limits?.users === Infinity;

  const currentUserId = (session?.user as CustomUser)?.id;

  const [removingId, setRemovingId] = useState<string>("");
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isAddSeatOpen, setIsAddSeatOpen] = useState(false);

  const removeMember = async (userId: string) => {
    setRemovingId(userId);
    try {
      const response = await fetch(
        `/api/teams/${currentTeamId}/datarooms/${dataroomId}/members`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        },
      );
      if (response.status !== 204) {
        const { error } = await response.json();
        toast.error(error || "Could not remove member.");
        return;
      }
      await mutateMembers();
      toast.success("Member removed from data room.");
    } catch (error) {
      toast.error("Could not remove member.");
    } finally {
      setRemovingId("");
    }
  };

  const revokeInvitation = async (email: string) => {
    setRemovingId(email);
    try {
      const response = await fetch(
        `/api/teams/${currentTeamId}/datarooms/${dataroomId}/members`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
      );
      if (response.status !== 204) {
        const { error } = await response.json();
        toast.error(error || "Could not revoke invitation.");
        return;
      }
      await mutateMembers();
      mutate(`/api/teams/${currentTeamId}/invitations`);
      toast.success("Invitation revoked.");
    } catch (error) {
      toast.error("Could not revoke invitation.");
    } finally {
      setRemovingId("");
    }
  };

  const isEmpty =
    !loading && members.length === 0 && invitations.length === 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-col items-start justify-between gap-3 border-b border-gray-200 p-5 sm:flex-row sm:items-center sm:p-6 dark:border-gray-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {dataroomName ? `${dataroomName} members` : "Members"}
            </h2>
            <BadgeTooltip
              content="Teammates that have access to this data room."
              className="max-w-80 text-left leading-5 text-gray-600"
            >
              <CircleHelpIcon className="h-4 w-4 text-gray-400" />
            </BadgeTooltip>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            People on your team with access to this data room.
            {!seatsUnlimited && limits?.users ? (
              <span className="ml-1">
                {limits.usage?.users ?? 0}/{limits.users} seats used.
              </span>
            ) : null}
          </p>
        </div>
        {canInvite ? (
          showUpgradePlanModal ? (
            <UpgradeButton
              text="Business"
              clickedPlan={PlanEnum.Business}
              trigger="dataroom_add_member"
              highlightItem={["users", "assign"]}
            />
          ) : (
            <div className="flex items-center gap-2">
              {!seatsUnlimited ? (
                <AddSeatModal open={isAddSeatOpen} setOpen={setIsAddSeatOpen}>
                  <Button variant="outline" className="whitespace-nowrap">
                    Add Seat
                  </Button>
                </AddSeatModal>
              ) : null}
              {canAddUsers ? (
                <AddTeamMembers
                  open={isInviteOpen}
                  setOpen={setIsInviteOpen}
                  defaultRole="DATAROOM_MEMBER"
                  defaultDataroomIds={[dataroomId]}
                  currentDataroomId={dataroomId}
                  redirectToPeople={false}
                  onInvited={() => mutateMembers()}
                >
                  <Button className="whitespace-nowrap bg-gray-900 text-gray-50 hover:bg-gray-900/90">
                    Add team member
                  </Button>
                </AddTeamMembers>
              ) : (
                <Button disabled title="Add a seat to invite more members">
                  Add team member
                </Button>
              )}
            </div>
          )
        ) : null}
      </div>

      {loading ? (
        <div className="p-6">
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800"
              />
            ))}
          </div>
        </div>
      ) : isEmpty ? (
        <div className="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
          No team members have access to this data room yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                  Member
                </TableHead>
                <TableHead className="text-right text-xs font-medium tracking-wide text-gray-500">
                  Role
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const isSelf = member.userId === currentUserId;
                return (
                  <TableRow
                    key={member.userId}
                    className="hover:bg-transparent"
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <PersonAvatar
                          email={member.email}
                          name={member.name}
                        />
                        <div className="flex flex-col">
                          <span className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                            {member.name || member.email}
                            {isSelf ? (
                              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                You
                              </span>
                            ) : null}
                          </span>
                          <span className="text-xs text-gray-500">
                            {member.email}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm text-gray-700 dark:text-gray-300">
                      <div className="flex flex-col items-end gap-1">
                        <span>{ROLE_LABELS[member.role]}</span>
                        {member.status === "BLOCKED_TRIAL_EXPIRED" ? (
                          <span className="text-xs font-medium text-red-500">
                            Blocked (Trial Expired)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                            Active
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Only scoped members can be removed from a single room;
                          full members have team-wide access. */}
                      {canManage && member.scoped ? (
                        removingId === member.userId ? (
                          <span className="text-xs text-gray-500">
                            removing...
                          </span>
                        ) : (
                          <MemberRowMenu
                            onRemove={() => removeMember(member.userId)}
                          />
                        )
                      ) : (
                        <div className="ml-auto h-8 w-8" />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {invitations.map((invitation) => {
                const isPending =
                  new Date(invitation.expires) >= new Date();
                return (
                  <TableRow
                    key={invitation.email}
                    className="hover:bg-transparent"
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <PersonAvatar email={invitation.email} />
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {invitation.email}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm text-gray-700 dark:text-gray-300">
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-gray-500">Invited</span>
                        <span
                          className="text-xs text-gray-500"
                          title={`Expires on ${new Date(
                            invitation.expires,
                          ).toLocaleString()}`}
                        >
                          {isPending ? "Pending" : "Expired"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        removingId === invitation.email ? (
                          <span className="text-xs text-gray-500">
                            removing...
                          </span>
                        ) : (
                          <InvitationRowMenu
                            onRevoke={() => revokeInvitation(invitation.email)}
                          />
                        )
                      ) : (
                        <div className="ml-auto h-8 w-8" />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function PersonAvatar({
  email,
  name,
}: {
  email: string;
  name?: string | null;
}) {
  const label = (name || email || "").trim();
  return (
    <Avatar className="h-8 w-8 shrink-0 border border-gray-200 dark:border-gray-800">
      <AvatarImage
        src={`https://gravatar.com/avatar/${generateGravatarHash(
          email,
        )}?s=80&d=404`}
        alt={label}
      />
      <AvatarFallback className="bg-gray-100 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
        {label.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

function MemberRowMenu({ onRemove }: { onRemove: () => void }) {
  const [open, setOpen] = useState(false);

  const handleSelect = (event: Event, action: () => void) => {
    event.preventDefault();
    setOpen(false);
    action();
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto h-8 w-8"
          aria-label="Open member actions"
        >
          <MoreHorizontalIcon className="!h-4 !w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onSelect={(event) => handleSelect(event, onRemove)}
          className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-red-900/20"
        >
          <UserMinusIcon className="!h-4 !w-4" />
          Remove access
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InvitationRowMenu({ onRevoke }: { onRevoke: () => void }) {
  const [open, setOpen] = useState(false);

  const handleSelect = (event: Event, action: () => void) => {
    event.preventDefault();
    setOpen(false);
    action();
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto h-8 w-8"
          aria-label="Open invitation actions"
        >
          <MoreHorizontalIcon className="!h-4 !w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onSelect={(event) => handleSelect(event, onRevoke)}
          className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-red-900/20"
        >
          <XCircleIcon className="!h-4 !w-4" />
          Revoke invitation
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
