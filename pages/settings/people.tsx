import { useRouter } from "next/router";

import { useMemo, useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import {
  CircleHelpIcon,
  MoreHorizontalIcon,
  SendIcon,
  UserCogIcon,
  UserMinusIcon,
  XCircleIcon,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { mutate } from "swr";

import { useAnalytics } from "@/lib/analytics";
import { usePlan } from "@/lib/swr/use-billing";
import useDataroomsSimple from "@/lib/swr/use-datarooms-simple";
import { useInvitations } from "@/lib/swr/use-invitations";
import useLimits from "@/lib/swr/use-limits";
import { useGetTeam } from "@/lib/swr/use-team";
import { useTeams } from "@/lib/swr/use-teams";
import { CustomUser, TeamRole } from "@/lib/types";
import { cn, generateGravatarHash } from "@/lib/utils";

import { AddSeatModal } from "@/components/billing/add-seat-modal";
import { UnlimitedPlanModal } from "@/components/billing/unlimited-plan-modal";
import AppLayout from "@/components/layouts/app";
import { SettingsHeader } from "@/components/settings/settings-header";
import { AddTeamMembers } from "@/components/teams/add-team-member-modal";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  DATAROOM_MEMBER: "Data Room Member",
};

const ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  ADMIN: "Full access to the team, billing, and all settings.",
  MANAGER: "Manage content and members, except admin-only settings.",
  MEMBER: "Create and manage documents, links, and data rooms.",
  DATAROOM_MEMBER: "Access limited to the specific data rooms you assign.",
};

const ASSIGNABLE_ROLES: TeamRole[] = [
  "ADMIN",
  "MANAGER",
  "MEMBER",
  "DATAROOM_MEMBER",
];

function formatRole(role: string): string {
  return ROLE_LABELS[role as TeamRole] ?? role;
}

export default function Billing() {
  const [isTeamMemberInviteModalOpen, setTeamMemberInviteModalOpen] =
    useState<boolean>(false);
  const [isAddSeatModalOpen, setAddSeatModalOpen] = useState<boolean>(false);
  const [leavingUserId, setLeavingUserId] = useState<string>("");

  const { data: session } = useSession();
  const { team, loading } = useGetTeam()!;
  const teamInfo = useTeam();
  const { isTrial, isDataroomsUnlimited } = usePlan();
  const { canAddUsers, showUpgradePlanModal, limits } = useLimits();
  const { teams } = useTeams();
  const analytics = useAnalytics();

  const { invitations } = useInvitations();

  const router = useRouter();

  const { datarooms } = useDataroomsSimple();

  // Map of dataroom id -> display name, for rendering assignment tags.
  const dataroomNameById = useMemo(() => {
    const map: Record<string, string> = {};
    (datarooms ?? []).forEach((dataroom) => {
      map[dataroom.id] = dataroom.internalName || dataroom.name;
    });
    return map;
  }, [datarooms]);

  // Map of user id -> assigned dataroom ids (for DATAROOM_MEMBERs).
  const dataroomIdsByUser = useMemo(() => {
    const map: Record<string, string[]> = {};
    (team?.userDatarooms ?? []).forEach((ud) => {
      (map[ud.userId] ??= []).push(ud.dataroomId);
    });
    return map;
  }, [team?.userDatarooms]);

  const isCurrentUser = (userId: string) => {
    if ((session?.user as CustomUser)?.id === userId) {
      return true;
    }
    return false;
  };

  const isCurrentUserAdmin = () => {
    return (
      team?.users.some(
        (user) =>
          user.role === "ADMIN" &&
          user.userId === (session?.user as CustomUser)?.id,
      ) ?? false
    );
  };

  // Member currently being edited in the change-role dialog.
  const [roleMember, setRoleMember] = useState<{
    userId: string;
    teamId: string;
    name: string;
    role: TeamRole;
  } | null>(null);

  const changeRole = async (
    teamId: string,
    userId: string,
    role: "ADMIN" | "MANAGER" | "MEMBER" | "DATAROOM_MEMBER",
    dataroomIds?: string[],
  ) => {
    const response = await fetch(`/api/teams/${teamId}/change-role`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userToBeChanged: userId,
        role: role,
        ...(role === "DATAROOM_MEMBER"
          ? { dataroomIds: dataroomIds ?? [] }
          : {}),
      }),
    });

    if (response.status !== 204) {
      const error = await response.json();
      toast.error(error);
      return;
    }

    await mutate(`/api/teams/${teamId}`);
    await mutate("/api/teams");

    analytics.capture("Team Member Role Changed", {
      userId: userId,
      teamId: teamId,
      role: role,
    });

    toast.success("Role changed successfully!");
  };

  const removeTeammate = async (teamId: string, userId: string) => {
    setLeavingUserId(userId);
    const response = await fetch(`/api/teams/${teamId}/remove-teammate`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userToBeDeleted: userId,
      }),
    });

    if (response.status !== 204) {
      const error = await response.json();
      toast.error(error);
      setLeavingUserId("");
      return;
    }

    await mutate(`/api/teams/${teamInfo?.currentTeam?.id}`);
    await mutate("/api/teams");
    mutate(`/api/teams/${teamInfo?.currentTeam?.id}/invitations`);
    mutate(`/api/teams/${teamInfo?.currentTeam?.id}/limits`);

    setLeavingUserId("");
    if (isCurrentUser(userId)) {
      toast.success(`Successfully leaved team ${teamInfo?.currentTeam?.name}`);
      teamInfo?.setCurrentTeam({ id: teams![0].id });
      router.push("/documents");
      return;
    }

    analytics.capture("Team Member Removed", {
      userId: userId,
      teamId: teamInfo?.currentTeam?.id,
    });

    toast.success("Teammate removed successfully!");
  };

  // resend invitation function
  const resendInvitation = async (invitation: { email: string } & any) => {
    const response = await fetch(
      `/api/teams/${teamInfo?.currentTeam?.id}/invitations/resend`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: invitation.email as string,
        }),
      },
    );

    if (response.status !== 200) {
      const error = await response.json();
      toast.error(error);
      return;
    }

    analytics.capture("Team Member Invitation Resent", {
      email: invitation.email as string,
      teamId: teamInfo?.currentTeam?.id,
    });
    mutate(`/api/teams/${teamInfo?.currentTeam?.id}/invitations`);
    mutate(`/api/teams/${teamInfo?.currentTeam?.id}/limits`);

    toast.success("Invitation resent successfully!");
  };

  // revoke invitation function
  const revokeInvitation = async (invitation: { email: string } & any) => {
    const response = await fetch(
      `/api/teams/${teamInfo?.currentTeam?.id}/invitations`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: invitation.email as string,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      toast.error(error);
      return;
    }

    analytics.capture("Team Member Invitation Revoked", {
      email: invitation.email as string,
      teamId: teamInfo?.currentTeam?.id,
    });

    mutate(`/api/teams/${teamInfo?.currentTeam?.id}/invitations`);
    mutate(`/api/teams/${teamInfo?.currentTeam?.id}/limits`);

    toast.success("Invitation revoked successfully!");
  };
  const showInvite = canAddUsers;

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />

        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-col items-start justify-between gap-3 border-b border-gray-200 p-5 sm:flex-row sm:items-center sm:p-6 dark:border-gray-800">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Team Members
                </h2>
                <BadgeTooltip
                  content="Teammates that have access to this workspace."
                  className="max-w-80 text-left leading-5 text-gray-600"
                >
                  <CircleHelpIcon className="h-4 w-4 text-gray-400" />
                </BadgeTooltip>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Manage your team members.{" "}
                {isDataroomsUnlimited ? (
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    Your team has unlimited seats 💫
                  </span>
                ) : (
                  <>
                    {limits?.users && limits.users !== Infinity ? (
                      <span>
                        {limits.usage?.users ?? 0}/{limits.users} seats used.{" "}
                      </span>
                    ) : null}
                    <UnlimitedPlanModal>
                      <span className="cursor-pointer underline underline-offset-4 hover:text-foreground">
                        Need unlimited seats?
                      </span>
                    </UnlimitedPlanModal>
                  </>
                )}
              </p>
            </div>
            {showUpgradePlanModal ? (
              <UpgradeButton
                text="Invite Members"
                clickedPlan={PlanEnum.Business}
                trigger="invite_team_members"
                highlightItem={["users"]}
              />
            ) : (
              <div className="flex items-center gap-2">
                {!isDataroomsUnlimited && (
                  <AddSeatModal
                    open={isAddSeatModalOpen}
                    setOpen={setAddSeatModalOpen}
                  >
                    <Button variant="outline" className="whitespace-nowrap">
                      Add Seat
                    </Button>
                  </AddSeatModal>
                )}
                {showInvite ? (
                  <AddTeamMembers
                    open={isTeamMemberInviteModalOpen}
                    setOpen={setTeamMemberInviteModalOpen}
                  >
                    <Button className="bg-gray-900 text-gray-50 hover:bg-gray-900/90">
                      Invite
                    </Button>
                  </AddTeamMembers>
                ) : (
                  <Button disabled title="Add a seat to invite more members">
                    Invite
                  </Button>
                )}
              </div>
            )}
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
                  {team?.users.map((member) => {
                    return (
                      <TableRow
                        key={member.userId}
                        className="hover:bg-transparent"
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <PersonAvatar
                              email={member.user.email}
                              name={member.user.name}
                            />
                            <div className="flex flex-col">
                              <span className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                                {member.user.name || member.user.email}
                                {isCurrentUser(member.userId) ? (
                                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                    You
                                  </span>
                                ) : null}
                              </span>
                              <span className="text-xs text-gray-500">
                                {member.user.email}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm text-gray-700 dark:text-gray-300">
                          <div className="flex flex-col items-end gap-1">
                            <span>{formatRole(member.role)}</span>
                            {member.role === "DATAROOM_MEMBER" &&
                            (dataroomIdsByUser[member.userId]?.length ?? 0) >
                              0 ? (
                              <div className="flex max-w-[240px] flex-wrap justify-end gap-1">
                                {dataroomIdsByUser[member.userId].map((id) => (
                                  <span
                                    key={id}
                                    className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                                    title={dataroomNameById[id] || "Data room"}
                                  >
                                    {dataroomNameById[id] || "Data room"}
                                  </span>
                                ))}
                              </div>
                            ) : null}
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
                          {leavingUserId === member.userId ? (
                            <span className="text-xs text-gray-500">
                              leaving...
                            </span>
                          ) : (
                            <MemberRowMenu
                              canManage={
                                isCurrentUserAdmin() &&
                                !isCurrentUser(member.userId)
                              }
                              isCurrentUser={isCurrentUser(member.userId)}
                              onChangeRole={() =>
                                setRoleMember({
                                  userId: member.userId,
                                  teamId: member.teamId,
                                  name: member.user.name || member.user.email,
                                  role: member.role,
                                })
                              }
                              onRemove={() =>
                                removeTeammate(member.teamId, member.userId)
                              }
                              onLeave={() =>
                                removeTeammate(member.teamId, member.userId)
                              }
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {invitations?.map((invitation) => {
                    const isPending =
                      new Date(invitation.expires) >= new Date(Date.now());
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
                          <InvitationRowMenu
                            onResend={() => resendInvitation(invitation)}
                            onRevoke={() => revokeInvitation(invitation)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </main>

      {roleMember ? (
        <ChangeRoleDialog
          member={roleMember}
          currentAssignments={(team?.userDatarooms ?? [])
            .filter((ud) => ud.userId === roleMember.userId)
            .map((ud) => ud.dataroomId)}
          onClose={() => setRoleMember(null)}
          onSave={async (role, dataroomIds) => {
            await changeRole(
              roleMember.teamId,
              roleMember.userId,
              role,
              dataroomIds,
            );
            setRoleMember(null);
          }}
        />
      ) : null}
    </AppLayout>
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

function MemberRowMenu({
  canManage,
  isCurrentUser,
  onChangeRole,
  onRemove,
  onLeave,
}: {
  canManage: boolean;
  isCurrentUser: boolean;
  onChangeRole: () => void;
  onRemove: () => void;
  onLeave: () => void;
}) {
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
          className="h-8 w-8"
          aria-label="Open member actions"
        >
          <MoreHorizontalIcon className="!h-4 !w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {isCurrentUser ? (
          <DropdownMenuItem
            onSelect={(event) => handleSelect(event, onLeave)}
            className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-red-900/20"
          >
            <UserMinusIcon className="!h-4 !w-4" />
            Leave team
          </DropdownMenuItem>
        ) : canManage ? (
          <>
            <DropdownMenuItem
              onSelect={(event) => handleSelect(event, onChangeRole)}
            >
              <UserCogIcon className="!h-4 !w-4 text-gray-500" />
              Change role
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => handleSelect(event, onRemove)}
              className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-red-900/20"
            >
              <UserMinusIcon className="!h-4 !w-4" />
              Remove member
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem
            disabled
            className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-red-900/20"
          >
            <UserMinusIcon className="!h-4 !w-4" />
            Remove member
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InvitationRowMenu({
  onResend,
  onRevoke,
}: {
  onResend: () => void;
  onRevoke: () => void;
}) {
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
          className="h-8 w-8"
          aria-label="Open invitation actions"
        >
          <MoreHorizontalIcon className="!h-4 !w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={(event) => handleSelect(event, onResend)}>
          <SendIcon className="!h-4 !w-4 text-gray-500" />
          Resend
        </DropdownMenuItem>
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

function ChangeRoleDialog({
  member,
  currentAssignments,
  onClose,
  onSave,
}: {
  member: { userId: string; teamId: string; name: string; role: TeamRole };
  currentAssignments: string[];
  onClose: () => void;
  onSave: (role: TeamRole, dataroomIds: string[]) => Promise<void>;
}) {
  const { datarooms } = useDataroomsSimple();
  const [role, setRole] = useState<TeamRole>(member.role);
  const [selected, setSelected] = useState<string[]>(currentAssignments);
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const assignmentsUnchanged =
    selected.length === currentAssignments.length &&
    selected.every((id) => currentAssignments.includes(id));

  const isUnchanged =
    role === member.role &&
    (role !== "DATAROOM_MEMBER" || assignmentsUnchanged);

  const canSave =
    !saving &&
    !isUnchanged &&
    (role !== "DATAROOM_MEMBER" || selected.length > 0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader className="text-start">
          <DialogTitle>Change role</DialogTitle>
          <DialogDescription>
            Update the role for {member.name}.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={role}
          onValueChange={(value) => setRole(value as TeamRole)}
          className="gap-2"
        >
          {ASSIGNABLE_ROLES.map((r) => (
            <label
              key={r}
              htmlFor={`role-${r}`}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors",
                role === r
                  ? "border-primary bg-muted"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <RadioGroupItem id={`role-${r}`} value={r} className="mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-medium leading-none">{ROLE_LABELS[r]}</p>
                <p className="text-xs text-muted-foreground">
                  {ROLE_DESCRIPTIONS[r]}
                </p>
              </div>
            </label>
          ))}
        </RadioGroup>

        {role === "DATAROOM_MEMBER" ? (
          <div className="grid gap-1.5">
            <div className="space-y-1">
              <Label className="opacity-80">Data rooms</Label>
              <p className="text-xs text-muted-foreground">
                Select the data rooms {member.name} can manage.
              </p>
            </div>
            <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border p-1">
              {datarooms && datarooms.length > 0 ? (
                datarooms.map((dataroom) => (
                  <div
                    key={dataroom.id}
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      id={`role-dataroom-${dataroom.id}`}
                      checked={selected.includes(dataroom.id)}
                      onCheckedChange={() => toggle(dataroom.id)}
                      className="h-4 w-4"
                    />
                    <label
                      htmlFor={`role-dataroom-${dataroom.id}`}
                      className="flex-1 cursor-pointer truncate"
                    >
                      {dataroom.internalName || dataroom.name}
                    </label>
                  </div>
                ))
              ) : (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  No data rooms available.
                </p>
              )}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            disabled={!canSave}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(role, role === "DATAROOM_MEMBER" ? selected : []);
              } finally {
                setSaving(false);
              }
            }}
            className="h-9 w-full"
          >
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
