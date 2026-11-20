import Link from "next/link";

import { useState } from "react";

import { useTeam } from "@/context/team-context";
import type { LinkType } from "@prisma/client";
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  FileIcon,
  GlobeIcon,
  LinkIcon,
  MailIcon,
  MoreVerticalIcon,
  PencilIcon,
  PlusIcon,
  ServerIcon,
  TrashIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";
import useSWR from "swr";

import useVisitorGroups, {
  VisitorGroupWithCount,
} from "@/lib/swr/use-visitor-groups";
import { cn, fetcher } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

import { VisitorGroupModal } from "./visitor-group-modal";

type VisitorGroupLink = {
  id: string;
  link: {
    id: string;
    name: string | null;
    linkType: LinkType;
    documentId: string | null;
    dataroomId: string | null;
    document: { id: string; name: string } | null;
    dataroom: { id: string; name: string } | null;
  };
};

type VisitorGroupDetail = VisitorGroupWithCount & {
  links: VisitorGroupLink[];
};

const splitMembers = (members: string[]) => {
  const domainMembers = members.filter((member) => member.startsWith("@"));
  const emailMembers = members.filter((member) => !member.startsWith("@"));
  return { emailMembers, domainMembers };
};

function VisitorGroupCard({
  group,
  teamId,
  onEdit,
  onDelete,
}: {
  group: VisitorGroupWithCount;
  teamId?: string;
  onEdit: (group: VisitorGroupWithCount) => void;
  onDelete: (group: VisitorGroupWithCount) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: groupDetails, isLoading: loadingDetails } =
    useSWR<VisitorGroupDetail>(
      expanded && teamId
        ? `/api/teams/${teamId}/visitor-groups/${group.id}`
        : null,
      fetcher,
    );

  const members = groupDetails?.emails ?? group.emails ?? [];
  const memberCount = members.length;
  const linkCount = groupDetails?._count.links ?? group._count.links;
  const { emailMembers, domainMembers } = splitMembers(members);
  const previewMembers = members.slice(0, 5);
  const extraMembersCount = Math.max(members.length - previewMembers.length, 0);

  const links = groupDetails?.links ?? [];
  const documentLinks = links.filter(
    (item) => item.link.linkType !== "DATAROOM_LINK",
  );
  const dataroomLinks = links.filter(
    (item) => item.link.linkType === "DATAROOM_LINK",
  );

  const hasLinkedItems =
    loadingDetails || documentLinks.length > 0 || dataroomLinks.length > 0;

  const toggle = () => setExpanded((prev) => !prev);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-gray-200 transition-colors dark:border-gray-800",
        expanded
          ? "bg-gray-50/80 dark:bg-gray-900/70"
          : "bg-white hover:bg-gray-50/50 dark:bg-gray-900 dark:hover:bg-gray-800/40",
      )}
    >
      {/* Clickable header */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        }}
        className="cursor-pointer px-4 pt-3.5 sm:px-5 sm:pt-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gradient-to-t from-gray-100 dark:border-gray-700 dark:from-gray-800">
                <UsersIcon className="h-3.5 w-3.5 text-foreground" />
              </div>
              <p className="truncate text-sm font-semibold text-foreground">
                {group.name}
              </p>
            </div>

            <div className="mt-2 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-muted-foreground dark:bg-gray-800">
                <UsersIcon className="h-3 w-3" />
                {memberCount} {memberCount === 1 ? "member" : "members"}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-muted-foreground dark:bg-gray-800">
                <LinkIcon className="h-3 w-3" />
                {linkCount} {linkCount === 1 ? "link" : "links"}
              </span>
            </div>

            {!expanded && previewMembers.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {previewMembers.map((member) => (
                  <span
                    key={`${group.id}-${member}`}
                    className={cn(
                      "inline-flex items-center rounded-md px-2 py-0.5 text-xs",
                      member.startsWith("@")
                        ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300"
                        : "bg-gray-100 text-foreground dark:bg-gray-800",
                    )}
                  >
                    {member}
                  </span>
                ))}
                {extraMembersCount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    +{extraMembersCount} more
                  </span>
                )}
              </div>
            )}
          </div>

          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-7 w-7 border-gray-200 bg-transparent p-0 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVerticalIcon className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(group);
                }}
              >
                <PencilIcon className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(group);
                }}
                className="text-destructive focus:text-destructive"
              >
                <TrashIcon className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3 pt-3 sm:px-5 sm:pb-4">
          <div className="space-y-3">
            {emailMembers.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Email Members ({emailMembers.length})
                </p>
                <div className="mt-1.5 space-y-0.5">
                  {emailMembers.map((email) => (
                    <div
                      key={`${group.id}-email-${email}`}
                      className="flex items-center gap-2 py-0.5 text-xs text-foreground"
                    >
                      <MailIcon className="h-3 w-3 text-muted-foreground" />
                      <span>{email}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {domainMembers.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Domain Access ({domainMembers.length})
                </p>
                <div className="mt-1.5 space-y-0.5">
                  {domainMembers.map((domain) => (
                    <div
                      key={`${group.id}-domain-${domain}`}
                      className="flex items-center gap-2 py-0.5 text-xs text-foreground"
                    >
                      <GlobeIcon className="h-3 w-3 text-muted-foreground" />
                      <span>{domain}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasLinkedItems && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Links ({documentLinks.length + dataroomLinks.length})
                </p>

                {loadingDetails ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Loading...
                  </p>
                ) : (
                  <div className="mt-1.5 space-y-1">
                    {documentLinks.map((groupLink: VisitorGroupLink) => {
                      const documentId = groupLink.link.documentId;
                      const content = (
                        <div className="flex min-w-0 items-center gap-2">
                          <FileIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate text-xs font-medium text-foreground">
                            {groupLink.link.document?.name ||
                              "Untitled document"}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            via {groupLink.link.name || "Untitled link"}
                          </span>
                        </div>
                      );
                      return documentId ? (
                        <Link
                          key={groupLink.id}
                          href={`/documents/${documentId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="group/link flex items-center justify-between rounded-md border border-gray-200 bg-white px-2.5 py-1.5 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50 dark:hover:bg-gray-800"
                        >
                          {content}
                          <ExternalLinkIcon className="ml-2 h-3 w-3 shrink-0 text-muted-foreground transition-colors group-hover/link:text-foreground" />
                        </Link>
                      ) : (
                        <div
                          key={groupLink.id}
                          className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-2.5 py-1.5 dark:border-gray-700 dark:bg-gray-800/50"
                        >
                          {content}
                        </div>
                      );
                    })}
                    {dataroomLinks.map((groupLink) => {
                      const dataroomId = groupLink.link.dataroomId;
                      const content = (
                        <>
                          <div className="flex min-w-0 items-center gap-2">
                            <ServerIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="truncate text-xs font-medium text-foreground">
                              {groupLink.link.dataroom?.name ||
                                "Untitled dataroom"}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              via {groupLink.link.name || "Untitled link"}
                            </span>
                          </div>
                        </>
                      );
                      return dataroomId ? (
                        <Link
                          key={groupLink.id}
                          href={`/datarooms/${dataroomId}/permissions`}
                          onClick={(e) => e.stopPropagation()}
                          className="group/link flex items-center justify-between rounded-md border border-gray-200 bg-white px-2.5 py-1.5 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50 dark:hover:bg-gray-800"
                        >
                          {content}
                          <ExternalLinkIcon className="ml-2 h-3 w-3 shrink-0 text-muted-foreground transition-colors group-hover/link:text-foreground" />
                        </Link>
                      ) : (
                        <div
                          key={groupLink.id}
                          className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-2.5 py-1.5 dark:border-gray-700 dark:bg-gray-800/50"
                        >
                          {content}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chevron toggle at center bottom */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        }}
        className="flex cursor-pointer justify-center py-1 transition-colors hover:bg-gray-100/60 dark:hover:bg-gray-800/40"
      >
        <ChevronDownIcon
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </div>
    </div>
  );
}

export function VisitorGroupsSection() {
  const { visitorGroups, loading } = useVisitorGroups();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] =
    useState<VisitorGroupWithCount | null>(null);
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const handleEdit = (group: VisitorGroupWithCount) => {
    setEditingGroup(group);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditingGroup(null);
    setModalOpen(true);
  };

  const handleDelete = async (group: VisitorGroupWithCount) => {
    if (
      !confirm(
        `Are you sure you want to delete "${group.name}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      const response = await fetch(
        `/api/teams/${teamInfo?.currentTeam?.id}/visitor-groups/${group.id}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || "Failed to delete visitor group.");
        return;
      }

      toast.success("Visitor group deleted successfully.");
      mutate(`/api/teams/${teamInfo?.currentTeam?.id}/visitor-groups`);
    } catch (error) {
      toast.error("Error deleting visitor group. Please try again.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-x-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground">
            Visitor Groups
          </h3>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Create groups of emails and domains, then apply them to link allow
            lists.
          </p>
        </div>
        <Button onClick={handleCreate} size="sm" className="shrink-0 gap-1.5 whitespace-nowrap">
          <PlusIcon className="h-4 w-4" />
          Create Group
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : !visitorGroups || visitorGroups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <UsersIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h4 className="mt-2 text-sm font-medium text-foreground">
            No visitor groups yet
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first visitor group to manage access across multiple
            links.
          </p>
          <Button
            onClick={handleCreate}
            variant="outline"
            size="sm"
            className="mt-4 gap-1.5"
          >
            <PlusIcon className="h-4 w-4" />
            Create Group
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {visitorGroups.map((group) => (
            <VisitorGroupCard
              key={group.id}
              group={group}
              teamId={teamId}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <VisitorGroupModal
        open={modalOpen}
        setOpen={setModalOpen}
        existingGroup={editingGroup}
      />
    </div>
  );
}
