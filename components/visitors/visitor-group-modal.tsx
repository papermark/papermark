import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useTeam } from "@/context/team-context";
import { LinkType } from "@prisma/client";
import {
  ExternalLinkIcon,
  FileTextIcon,
  FolderKanbanIcon,
} from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";
import useSWR from "swr";

import { fetcher, validateList } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { VisitorGroupWithCount } from "@/lib/swr/use-visitor-groups";

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

export function VisitorGroupModal({
  open,
  setOpen,
  existingGroup,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  existingGroup?: VisitorGroupWithCount | null;
}) {
  const [groupName, setGroupName] = useState<string>("");
  const [emailsInput, setEmailsInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { data: existingGroupDetails, isLoading: loadingGroupDetails } =
    useSWR<VisitorGroupDetail>(
      open && existingGroup && teamId
        ? `/api/teams/${teamId}/visitor-groups/${existingGroup.id}`
        : null,
      fetcher,
    );

  useEffect(() => {
    if (existingGroup) {
      setGroupName(existingGroup.name);
      setEmailsInput(existingGroup.emails.join("\n"));
    } else {
      setGroupName("");
      setEmailsInput("");
    }
  }, [existingGroup, open]);

  const validation = useMemo(
    () => validateList(emailsInput, "both"),
    [emailsInput],
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (!groupName || groupName.trim().length < 2) {
      toast.error("Please provide a group name with at least 2 characters.");
      return;
    }

    if (validation.invalid.length > 0) {
      toast.error(
        `Fix invalid emails or domains: ${validation.invalid
          .slice(0, 3)
          .join(", ")}${validation.invalid.length > 3 ? ", ..." : ""}`,
      );
      return;
    }

    setLoading(true);

    const emails = validation.valid;

    try {
      const url = existingGroup
        ? `/api/teams/${teamId}/visitor-groups/${existingGroup.id}`
        : `/api/teams/${teamId}/visitor-groups`;

      const response = await fetch(url, {
        method: existingGroup ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: groupName.trim(), emails }),
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || "Failed to save visitor group.");
        return;
      }

      toast.success(
        existingGroup
          ? "Visitor group updated successfully!"
          : "Visitor group created successfully!",
      );

      mutate(
        `/api/teams/${teamId}/visitor-groups`,
      );
      if (existingGroup) {
        mutate(`/api/teams/${teamId}/visitor-groups/${existingGroup.id}`);
      }
      setOpen(false);
    } catch (error) {
      toast.error("Error saving visitor group. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader className="text-start">
          <DialogTitle>
            {existingGroup ? "Edit Visitor Group" : "Create Visitor Group"}
          </DialogTitle>
          <DialogDescription>
            {existingGroup
              ? "Update the group name and email list. Changes will apply to all links using this group."
              : "Create a named group of emails and domains. You can then apply this group to document and data room links."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="group-name" className="opacity-80">
                Group Name
              </Label>
              <Input
                id="group-name"
                placeholder="e.g., Series A Investors"
                className="mt-1 w-full"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="group-emails" className="opacity-80">
                Emails & Domains
              </Label>
              <Textarea
                id="group-emails"
                className="mt-1 w-full focus:ring-inset"
                rows={6}
                placeholder={`Enter emails or domains separated by comma, semicolon, or new line, e.g.
investor@fund.com
partner@vc.com
@example.org`}
                value={emailsInput}
                onChange={(e) => setEmailsInput(e.target.value)}
                aria-invalid={validation.invalid.length > 0}
              />
              {validation.invalid.length > 0 ? (
                <p className="mt-1 text-xs text-destructive">
                  The following entries are not valid emails or domains and
                  must be fixed before saving:{" "}
                  <span className="font-medium">
                    {validation.invalid.slice(0, 5).join(", ")}
                    {validation.invalid.length > 5
                      ? `, and ${validation.invalid.length - 5} more`
                      : ""}
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Separate multiple entries with a comma, semicolon, or new
                  line. Use <code>@domain.com</code> to allow all emails from a
                  domain.
                </p>
              )}
            </div>

            {existingGroup && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Linked Documents & Datarooms
                </p>
                {loadingGroupDetails ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Loading...
                  </p>
                ) : existingGroupDetails?.links?.length ? (
                  <div className="mt-1.5 space-y-1">
                    {existingGroupDetails.links.map((groupLink) => {
                      const isDataroom =
                        groupLink.link.linkType === "DATAROOM_LINK";
                      const entity = isDataroom
                        ? groupLink.link.dataroom
                        : groupLink.link.document;
                      const href = isDataroom
                        ? groupLink.link.dataroomId
                          ? `/datarooms/${groupLink.link.dataroomId}/documents`
                          : null
                        : groupLink.link.documentId
                          ? `/documents/${groupLink.link.documentId}`
                          : null;

                      return (
                        <div
                          key={groupLink.id}
                          className="flex items-center justify-between rounded-md border border-gray-200 px-2.5 py-1.5 dark:border-gray-800"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {isDataroom ? (
                              <FolderKanbanIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate text-xs font-medium text-foreground">
                              {entity?.name ||
                                (isDataroom
                                  ? "Untitled dataroom"
                                  : "Untitled document")}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              via {groupLink.link.name || "Untitled link"}
                            </span>
                          </div>
                          {href && (
                            <Link
                              href={href}
                              className="ml-2 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <ExternalLinkIcon className="h-3.5 w-3.5" />
                            </Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Not linked to any documents or datarooms yet.
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button
              type="submit"
              loading={loading}
              disabled={validation.invalid.length > 0}
              className="h-9 w-full"
            >
              {existingGroup ? "Update Group" : "Create Group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
