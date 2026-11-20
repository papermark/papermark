import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { LinkIcon, PencilIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";

import {
  VisitorAccessSource,
  VisitorRecord,
} from "@/lib/api/visitors/get-visitors";
import { buildLinkFormData } from "@/lib/links/build-link-form-data";
import { LinkWithViews } from "@/lib/types";
import { fetcher } from "@/lib/utils";

import { DataroomLinkSheet } from "@/components/links/link-sheet/dataroom-link-sheet";
import { DEFAULT_LINK_TYPE } from "@/components/links/link-sheet";

import { VisitorStatusBadge } from "./visitor-status-badge";

const LINK_SOURCES = ["ALLOW_LIST", "INVITATION", "DENY_LIST"] as const;
const GROUP_SOURCES = ["GROUP", "VISITOR_GROUP"] as const;

const SOURCE_PREFIX: Record<string, string> = {
  ALLOW_LIST: "Allow list of",
  INVITATION: "Invited on",
  DENY_LIST: "Denied on",
};

/**
 * Where a visitor's access comes from — the detail the participants table only
 * hints at on the status tooltip. Data room links open for editing in place.
 */
export function VisitorAccessCard({ access }: { access: VisitorRecord }) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const [editing, setEditing] = useState<{
    dataroomId: string;
    link: DEFAULT_LINK_TYPE;
  } | null>(null);
  // Only fetch a room's links once someone asks to edit one of them.
  const [pendingDataroomId, setPendingDataroomId] = useState<string | null>(
    null,
  );
  const [pendingLinkId, setPendingLinkId] = useState<string | null>(null);

  const { isLoading } = useSWR<LinkWithViews[]>(
    teamId && pendingDataroomId
      ? `/api/teams/${teamId}/datarooms/${pendingDataroomId}/links`
      : null,
    fetcher,
    {
      onSuccess: (links) => {
        const link = links?.find((item) => item.id === pendingLinkId);
        if (!link || !pendingDataroomId) {
          toast.error("That link is no longer available.");
        } else {
          setEditing({
            dataroomId: pendingDataroomId,
            link: buildLinkFormData(link),
          });
        }
        setPendingDataroomId(null);
        setPendingLinkId(null);
      },
      onError: () => {
        toast.error("Could not load the link. Please try again.");
        setPendingDataroomId(null);
        setPendingLinkId(null);
      },
    },
  );

  const groups = Array.from(
    new Set(
      access.accessSources
        .filter((source) =>
          GROUP_SOURCES.includes(source.type as (typeof GROUP_SOURCES)[number]),
        )
        .map((source) => source.name),
    ),
  );

  const links = access.accessSources.filter((source) =>
    LINK_SOURCES.includes(source.type as (typeof LINK_SOURCES)[number]),
  );

  const assignments = access.accessSources.filter(
    (source) => source.type === "ASSIGNMENT",
  );

  const openLink = (source: VisitorAccessSource) => {
    if (!source.id || !source.dataroomId) return;
    setPendingDataroomId(source.dataroomId);
    setPendingLinkId(source.id);
  };

  return (
    <>
      <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Access
          </span>
          <VisitorStatusBadge
            status={access.status}
            invitedAt={access.invitedAt}
            invitationStatus={access.invitationStatus}
            accessSources={access.accessSources}
          />
          {access.agreement ? (
            <span className="text-xs text-muted-foreground">
              {access.agreement.signed ? "Signed" : "Agreed to"}{" "}
              {access.agreement.name}
            </span>
          ) : null}
        </div>

        {groups.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {groups.map((group) => (
              <span
                key={`access-group-${group}`}
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-xs text-muted-foreground dark:border-gray-700"
              >
                <UsersIcon className="h-3 w-3 shrink-0" />
                {group}
              </span>
            ))}
          </div>
        )}

        {links.length > 0 && (
          <ul className="mt-3 space-y-1">
            {links.map((source) => {
              const editable = !!source.id && !!source.dataroomId;
              const busy = pendingLinkId === source.id && isLoading;

              return (
                <li
                  key={`access-link-${source.type}-${source.id ?? source.name}`}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <LinkIcon className="h-3 w-3 shrink-0" />
                  <span>
                    {SOURCE_PREFIX[source.type] ?? "Via"} {source.name}
                  </span>
                  {editable ? (
                    <button
                      type="button"
                      onClick={() => openLink(source)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                    >
                      <PencilIcon className="h-3 w-3" />
                      {busy ? "Opening..." : "Edit link"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {assignments.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Assigned in {assignments.map((source) => source.name).join(", ")}
          </p>
        )}

        {groups.length === 0 &&
          links.length === 0 &&
          assignments.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              No group or allow-list grant recorded — access came from an open
              link.
            </p>
          )}
      </div>

      {editing ? (
        <DataroomLinkSheet
          isOpen
          setIsOpen={(open: boolean) => {
            if (!open) setEditing(null);
          }}
          linkType="DATAROOM_LINK"
          currentLink={editing.link}
          linkTargetId={editing.dataroomId}
        />
      ) : null}
    </>
  );
}
