import { useRouter } from "next/router";

import { useEffect, useMemo, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import { InfoIcon } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";
import { z } from "zod";

import { useAnalytics } from "@/lib/analytics";
import { usePlan } from "@/lib/swr/use-billing";
import useDataroomsSimple from "@/lib/swr/use-datarooms-simple";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BadgeTooltip } from "@/components/ui/tooltip";

type InviteRole = "ADMIN" | "MANAGER" | "MEMBER" | "DATAROOM_MEMBER";

export function AddTeamMembers({
  open,
  setOpen,
  children,
  defaultRole = "MEMBER",
  defaultDataroomIds,
  currentDataroomId,
  redirectToPeople = true,
  onInvited,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  children?: React.ReactNode;
  /** Preselect a role (still editable). Defaults to "MEMBER". */
  defaultRole?: InviteRole;
  /** Preselect data rooms for a DATAROOM_MEMBER invite (still editable). */
  defaultDataroomIds?: string[];
  /** The data room the modal was opened from. It's pinned to the top of the list with a "This data room" hint. */
  currentDataroomId?: string;
  /** Redirect to /settings/people after a successful invite. Defaults to true. */
  redirectToPeople?: boolean;
  /** Called after a successful invite (e.g. to revalidate a scoped list). */
  onInvited?: () => void;
}) {
  const [email, setEmail] = useState<string>("");
  const [role, setRole] = useState<InviteRole>(defaultRole);
  const [selectedDataroomIds, setSelectedDataroomIds] = useState<string[]>(
    defaultDataroomIds ?? [],
  );
  const [loading, setLoading] = useState<boolean>(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const analytics = useAnalytics();
  const router = useRouter();
  const { datarooms } = useDataroomsSimple();
  const { isDatarooms, isTrial } = usePlan();

  // Pin the data room the modal was opened from to the top of the list.
  const orderedDatarooms = useMemo(() => {
    if (!datarooms) return datarooms;
    if (!currentDataroomId) return datarooms;
    const current = datarooms.find((d) => d.id === currentDataroomId);
    if (!current) return datarooms;
    return [current, ...datarooms.filter((d) => d.id !== currentDataroomId)];
  }, [datarooms, currentDataroomId]);

  // Reset to the preselected values each time the modal opens so the data-room
  // context (role + room) is applied, while staying editable by the user.
  useEffect(() => {
    if (open) {
      setEmail("");
      setRole(defaultRole);
      setSelectedDataroomIds(defaultDataroomIds ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleDataroom = (id: string) => {
    setSelectedDataroomIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };
  const emailSchema = z
    .string()
    .trim()
    .toLowerCase()
    .min(3, { message: "Please enter a valid email." })
    .email({ message: "Please enter a valid email." });

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const validation = emailSchema.safeParse(email);
    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }

    if (role === "DATAROOM_MEMBER" && selectedDataroomIds.length === 0) {
      toast.error("Select at least one data room for a data room member.");
      return;
    }

    setLoading(true);
    const response = await fetch(`/api/teams/${teamId}/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: validation.data,
        role,
        dataroomIds: role === "DATAROOM_MEMBER" ? selectedDataroomIds : [],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      setLoading(false);
      setOpen(false);
      toast.error(error);
      return;
    }

    analytics.capture("Team Member Invitation Sent", {
      email: validation.data,
      teamId: teamId,
    });

    mutate(`/api/teams/${teamId}/invitations`);
    mutate(`/api/teams/${teamId}/limits`);

    toast.success("An invitation email has been sent!");
    setOpen(false);
    setLoading(false);

    onInvited?.();

    // Redirect to the team members page (skipped when invoked from a data room).
    if (redirectToPeople) {
      router.push("/settings/people");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
      <DialogContent
        className="sm:max-w-[425px]"
        onOpenAutoFocus={(event) => {
          // The info button is the first focusable element in the dialog, and
          // Radix tooltips open on focus — without this the tooltip pops open
          // on its own every time the modal is launched.
          event.preventDefault();
          emailInputRef.current?.focus();
        }}
      >
        <DialogHeader className="text-start">
          <DialogTitle>Add Member</DialogTitle>
          <DialogDescription>
            You can easily add team members.{" "}
            <BadgeTooltip
              side="bottom"
              align="start"
              className="max-w-xs text-left"
              content={
                <div className="space-y-1.5">
                  <p>
                    <span className="font-medium text-foreground">Members</span>{" "}
                    join your team and can edit and manage documents, data
                    rooms, and links.
                  </p>
                  <p>
                    <span className="font-medium text-foreground">
                      Visitors
                    </span>{" "}
                    are people you share links with. They only get view access,
                    plus upload access on some plans. Visitors are unlimited on
                    every plan.
                  </p>
                </div>
              }
            >
              <button
                type="button"
                aria-label="Learn about members and visitors"
                className="inline-flex translate-y-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <InfoIcon className="size-3.5" />
              </button>
            </BadgeTooltip>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="email" className="opacity-80">
              Email
            </Label>
            <Input
              id="email"
              ref={emailInputRef}
              placeholder="team@member.com"
              className="w-full"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="role" className="opacity-80">
              Role
            </Label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as InviteRole)}
            >
              <SelectTrigger id="role" className="w-full">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="MANAGER">Manager</SelectItem>
                <SelectItem value="MEMBER">Member</SelectItem>
                <SelectItem
                  value="DATAROOM_MEMBER"
                  disabled={!isDatarooms && !isTrial}
                  trailingContent={
                    !isDatarooms && !isTrial ? (
                      <span className="ml-auto pl-3 text-xs text-muted-foreground">
                        Data Rooms plan
                      </span>
                    ) : undefined
                  }
                >
                  Data room member
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {role === "DATAROOM_MEMBER" ? (
            <div className="grid gap-1.5">
              <div className="space-y-1">
                <Label className="opacity-80">Data rooms</Label>
                <p className="text-xs text-muted-foreground">
                  The member can only manage the selected data rooms.
                </p>
              </div>
              <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border p-1">
                {orderedDatarooms && orderedDatarooms.length > 0 ? (
                  orderedDatarooms.map((dataroom) => (
                    <div
                      key={dataroom.id}
                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <Checkbox
                        id={`add-dataroom-${dataroom.id}`}
                        checked={selectedDataroomIds.includes(dataroom.id)}
                        onCheckedChange={() => toggleDataroom(dataroom.id)}
                        className="h-4 w-4"
                      />
                      <label
                        htmlFor={`add-dataroom-${dataroom.id}`}
                        className="flex flex-1 cursor-pointer items-center gap-2 truncate"
                      >
                        <span className="truncate">
                          {dataroom.internalName || dataroom.name}
                        </span>
                        {dataroom.id === currentDataroomId ? (
                          <span className="shrink-0 rounded-full border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            This data room
                          </span>
                        ) : null}
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

          <DialogFooter className="mt-2">
            <Button type="submit" className="h-9 w-full">
              {loading ? "Sending email..." : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
