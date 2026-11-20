import { UsersIcon } from "lucide-react";

import { cn, timeAgo } from "@/lib/utils";

import { BadgeTooltip } from "@/components/ui/tooltip";

export type VisitorStatus =
  | "BLOCKED"
  | "VISITED"
  | "INVITED"
  | "ALLOWED"
  | "ASSIGNED"
  | "NONE";

export type VisitorAccessSource = {
  type:
    | "ALLOW_LIST"
    | "VISITOR_GROUP"
    | "GROUP"
    | "DENY_LIST"
    | "ASSIGNMENT"
    | "BLOCK_LIST"
    | "INVITATION";
  name: string;
  id?: string | null;
  dataroomId?: string | null;
};

const SOURCE_LABEL: Record<VisitorAccessSource["type"], string> = {
  ALLOW_LIST: "Allow list of",
  VISITOR_GROUP: "Visitor group",
  GROUP: "Group",
  DENY_LIST: "Deny list of",
  ASSIGNMENT: "Assigned in",
  BLOCK_LIST: "On",
  INVITATION: "Invited on",
};

const describeSources = (sources: VisitorAccessSource[]) =>
  sources.map((source) => `${SOURCE_LABEL[source.type]} ${source.name}`);

export function VisitorStatusBadge({
  status,
  invitedAt,
  invitationStatus,
  accessSources,
  visitedLinks,
}: {
  status: VisitorStatus;
  invitedAt?: Date | string | null;
  invitationStatus?: string | null;
  accessSources?: VisitorAccessSource[];
  /** Links this person actually came through, named on the tooltip. */
  visitedLinks?: string[];
}) {
  const sources = accessSources ?? [];

  if (status === "BLOCKED") {
    const blockSources = describeSources(
      sources.filter(
        (source) => source.type === "DENY_LIST" || source.type === "BLOCK_LIST",
      ),
    );
    return (
      <BadgeTooltip
        content={
          blockSources.length
            ? blockSources.join(" · ")
            : "Blocked from accessing"
        }
        key="blocked"
      >
        <span className="inline-flex items-center rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
          Blocked
        </span>
      </BadgeTooltip>
    );
  }

  if (status === "VISITED") {
    const badge = (
      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        Visited
      </span>
    );

    if (!visitedLinks?.length) {
      return badge;
    }

    return (
      <BadgeTooltip content={`Visited via ${visitedLinks.join(", ")}`} key="visited">
        {badge}
      </BadgeTooltip>
    );
  }

  if (status === "INVITED") {
    const failed =
      invitationStatus === "BOUNCED" || invitationStatus === "FAILED";
    const label = failed
      ? invitationStatus === "BOUNCED"
        ? "Invite bounced"
        : "Invite failed"
      : "Invited";
    const inviteLinks = describeSources(
      sources.filter((source) => source.type === "INVITATION"),
    );
    const tooltip = [
      invitedAt ? `Invited ${timeAgo(invitedAt)}` : "Invited",
      ...inviteLinks,
      "Has not accessed yet",
    ].join(" · ");

    return (
      <BadgeTooltip content={tooltip} key={`invited-${label}`}>
        <span
          className={cn(
            "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
            failed
              ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
              : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
          )}
        >
          {label}
        </span>
      </BadgeTooltip>
    );
  }

  if (status === "ASSIGNED") {
    const assignmentSources = describeSources(
      sources.filter((source) => source.type === "ASSIGNMENT"),
    );
    return (
      <BadgeTooltip
        content={
          assignmentSources.length
            ? `${assignmentSources.join(" · ")} · Has not accessed yet`
            : "Assigned work · Has not accessed yet"
        }
        key="assigned"
      >
        <span className="inline-flex items-center rounded-md bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
          Assigned
        </span>
      </BadgeTooltip>
    );
  }

  if (status === "NONE") {
    return (
      <BadgeTooltip
        content="Known contact with no access grant and no activity"
        key="none"
      >
        <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-muted-foreground/70 dark:bg-gray-800">
          No activity
        </span>
      </BadgeTooltip>
    );
  }

  const accessDescriptions = describeSources(
    sources.filter((source) => source.type !== "BLOCK_LIST"),
  );

  // Access granted through a group is labelled with the group itself rather
  // than the generic allow-list wording.
  const groupNames = Array.from(
    new Set(
      sources
        .filter(
          (source) =>
            source.type === "GROUP" || source.type === "VISITOR_GROUP",
        )
        .map((source) => source.name),
    ),
  );

  if (groupNames.length > 0) {
    return (
      <BadgeTooltip
        content={
          accessDescriptions.length
            ? accessDescriptions.join(" · ")
            : "Has access through a group"
        }
        key="group-access"
      >
        <span className="inline-flex max-w-[180px] items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-muted-foreground dark:bg-gray-800">
          <UsersIcon className="h-3 w-3 shrink-0" />
          <span className="truncate">{groupNames[0]}</span>
          {groupNames.length > 1 ? (
            <span className="shrink-0">+{groupNames.length - 1}</span>
          ) : null}
        </span>
      </BadgeTooltip>
    );
  }

  return (
    <BadgeTooltip
      content={
        accessDescriptions.length
          ? accessDescriptions.join(" · ")
          : "Has access but has not visited yet"
      }
      key="allowed"
    >
      <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-muted-foreground dark:bg-gray-800">
        On allow list
      </span>
    </BadgeTooltip>
  );
}
