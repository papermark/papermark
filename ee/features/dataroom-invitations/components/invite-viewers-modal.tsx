import { useEffect, useMemo, useState } from "react";

import { useTeam } from "@/context/team-context";
import {
  MAX_INVITATION_EMAILS_PER_DAY,
  MAX_INVITATION_EMAILS_PER_REQUEST,
  invitationEmailSchema,
} from "@/ee/features/dataroom-invitations/lib/schema/dataroom-invitations";
import { useUninvitedMembers } from "@/ee/features/dataroom-invitations/lib/swr/use-dataroom-invitations";
import { Link } from "@prisma/client";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import useSWR from "swr";

import { fetcher } from "@/lib/utils";

import { PlanEnum } from "@/ee/stripe/constants";
import { CrownIcon } from "lucide-react";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type InviteViewersModalProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  dataroomId: string;
  dataroomName: string;
  groupId?: string;
  linkId?: string;
  defaultEmails?: string[];
  onSuccess?: () => void;
  canSend?: boolean;
};

type LinkOption = Pick<
  Link,
  "id" | "name" | "domainId" | "domainSlug" | "slug"
>;

function parseRecipientInput(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((email) => email.trim())
        .filter((email) => email.length > 0),
    ),
  );
}

export function InviteViewersModal({
  open,
  setOpen,
  dataroomId,
  dataroomName,
  groupId,
  linkId,
  defaultEmails = [],
  onSuccess,
  canSend = true,
}: InviteViewersModalProps) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { data: session } = useSession();
  const senderEmail = session?.user?.email ?? "you";

  const { data: groupLinks } = useSWR<LinkOption[]>(
    groupId && teamId
      ? `/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}/links`
      : null,
    fetcher,
    {
      dedupingInterval: 10000,
    },
  );
  const { uninvitedEmails, mutate: mutateUninvited } = useUninvitedMembers(
    groupId ? dataroomId : undefined,
    groupId,
  );

  const availableLinks: LinkOption[] = useMemo(() => {
    if (groupId) {
      return (
        groupLinks?.map((link) => {
          const last5 = link.id.slice(-5);
          return {
            id: link.id,
            name: link.name || `Link #${last5}`,
            domainId: link.domainId,
            domainSlug: link.domainSlug,
            slug: link.slug,
          };
        }) ?? []
      );
    }

    return linkId
      ? [
          {
            id: linkId,
            name: `Link #${linkId.slice(-5)}`,
            domainId: null,
            domainSlug: null,
            slug: null,
          },
        ]
      : [];
  }, [groupId, groupLinks, linkId]);

  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(
    () => linkId ?? availableLinks[0]?.id,
  );
  const [customMessage, setCustomMessage] = useState<string>("");
  const [recipientInput, setRecipientInput] = useState<string>("");
  const [hasEditedRecipients, setHasEditedRecipients] =
    useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!open) {
      setCustomMessage("");
      setRecipientInput("");
      setHasEditedRecipients(false);
      setSelectedLinkId(linkId ?? availableLinks[0]?.id);
      return;
    }

    if (!hasEditedRecipients) {
      const initialRecipients =
        defaultEmails.length > 0
          ? defaultEmails
          : groupId
            ? uninvitedEmails
            : [];

      if (initialRecipients.length > 0) {
        setRecipientInput(initialRecipients.join("\n"));
      }
    }
  }, [
    open,
    linkId,
    availableLinks,
    groupId,
    uninvitedEmails,
    defaultEmails,
    hasEditedRecipients,
  ]);

  useEffect(() => {
    if (!open) {
      setSelectedLinkId(linkId ?? availableLinks[0]?.id);
    }
  }, [open, linkId, availableLinks]);

  const selectedLink = availableLinks.find(
    (link) => link.id === selectedLinkId,
  );

  const defaultRecipients =
    defaultEmails.length > 0 ? defaultEmails : groupId ? uninvitedEmails : [];

  const currentRecipients =
    hasEditedRecipients && recipientInput.length > 0
      ? parseRecipientInput(recipientInput)
      : defaultRecipients;

  const recipientCount = currentRecipients.length;
  const isOverLimit = recipientCount > MAX_INVITATION_EMAILS_PER_REQUEST;

  const displayRecipients = currentRecipients.slice(0, 2);
  const remainingCount = recipientCount - displayRecipients.length;

  const fallbackSubject = `You are invited to view ${dataroomName}`;

  const handleClose = () => {
    setOpen(false);
    setLoading(false);
  };

  const handleSend = async () => {
    if (!teamId) {
      toast.error("No active team selected");
      return;
    }

    if (groupId && !selectedLinkId) {
      toast.error("Select a link to include in the invitation");
      return;
    }

    const parsedEmails = hasEditedRecipients
      ? parseRecipientInput(recipientInput)
      : defaultRecipients;

    if (parsedEmails.length > MAX_INVITATION_EMAILS_PER_REQUEST) {
      toast.error(
        `Maximum ${MAX_INVITATION_EMAILS_PER_REQUEST} recipients per request. You have ${parsedEmails.length}.`,
      );
      return;
    }

    if (parsedEmails.length > 0) {
      const invalidEmails = parsedEmails.filter(
        (email) => !invitationEmailSchema.safeParse(email).success,
      );

      if (invalidEmails.length > 0) {
        toast.error(
          `Found invalid emails: ${invalidEmails
            .slice(0, 3)
            .join(", ")}${invalidEmails.length > 3 ? "..." : ""}`,
        );
        return;
      }
    }

    const endpoint = groupId
      ? `/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}/invite`
      : linkId
        ? `/api/teams/${teamId}/datarooms/${dataroomId}/links/${linkId}/invite`
        : null;

    if (!endpoint) {
      toast.error("Unable to determine invitation endpoint");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(groupId ? { linkId: selectedLinkId } : {}),
          customMessage: customMessage.length > 0 ? customMessage : undefined,
          emails: parsedEmails,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to send invitations");
      }

      const payload = await response.json();
      const sentCount = payload?.success?.length ?? 0;
      const failedCount = payload?.failed?.length ?? 0;

      if (sentCount > 0) {
        toast.success(
          `Invitation${sentCount > 1 ? "s" : ""} sent to ${sentCount} recipient${
            sentCount > 1 ? "s" : ""
          }.`,
        );
      }

      if (failedCount > 0) {
        toast.error(
          `Failed to send to ${failedCount} recipient${
            failedCount > 1 ? "s" : ""
          }.`,
        );
      }

      onSuccess?.();
      if (groupId) {
        mutateUninvited();
      }
      handleClose();
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to send invitations");
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader className="text-left">
          <DialogTitle>Invite via email</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Your custom data room link will be shared via email directly from
            Papermark
          </p>
        </DialogHeader>

        <div className="grid gap-6 overflow-y-auto md:grid-cols-2">
          {/* Left Column - Input Fields */}
          <div className="space-y-4 md:overflow-y-auto md:pr-2">
            {groupId ? (
              <div className="space-y-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Choose link
                </span>
                <Select
                  value={selectedLinkId}
                  onValueChange={setSelectedLinkId}
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a link" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableLinks.map((link) => (
                      <SelectItem key={link.id} value={link.id}>
                        {link.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">
                Custom message
              </span>
              <Textarea
                value={customMessage}
                onChange={(event) => setCustomMessage(event.target.value)}
                rows={4}
                maxLength={500}
                placeholder="Add a short personal message (optional)"
                className="bg-muted"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                {customMessage.length}/500 characters
              </p>
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">
                Recipients
              </span>
              <Textarea
                value={recipientInput}
                onChange={(event) => {
                  setRecipientInput(event.target.value);
                  setHasEditedRecipients(true);
                }}
                placeholder={
                  defaultRecipients.length > 0
                    ? defaultRecipients.join("\n")
                    : "Enter email addresses separated by comma or new line"
                }
                className="bg-muted"
                rows={6}
                disabled={loading}
              />
              <p
                className={`text-xs ${isOverLimit ? "text-destructive" : "text-muted-foreground"}`}
              >
                {recipientInput.length > 0 || defaultRecipients.length > 0
                  ? isOverLimit
                    ? `${recipientCount} recipients — maximum ${MAX_INVITATION_EMAILS_PER_REQUEST} per request`
                    : `${recipientCount}/${MAX_INVITATION_EMAILS_PER_REQUEST} recipients`
                  : `Enter email addresses (max ${MAX_INVITATION_EMAILS_PER_REQUEST} per request, ${MAX_INVITATION_EMAILS_PER_DAY} per day)`}
              </p>
              <p className="text-xs text-muted-foreground">
                Contact{" "}
                <a
                  href="mailto:support@papermark.com"
                  className="underline hover:text-foreground"
                >
                  support@papermark.com
                </a>{" "}
                to increase your sending limits.
              </p>
            </div>
          </div>

          {/* Right Column - Email Preview */}
          <div className="hidden flex-col overflow-y-auto rounded-md border bg-muted/40 md:flex">
            <div className="sticky top-0 border-b bg-background/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <p className="font-medium text-foreground">Email preview</p>
            </div>

            <div className="flex-1 space-y-4 p-4 text-sm">
              <div className="space-y-1 text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Subject:</span>{" "}
                  {fallbackSubject}
                </p>
                <p>
                  <span className="font-medium text-foreground">From:</span>{" "}
                  system@papermark.com
                </p>
                <p>
                  <span className="font-medium text-foreground">To:</span>{" "}
                  {currentRecipients.length > 0 ? (
                    <>
                      {displayRecipients.join(", ")}
                      {remainingCount > 0 && (
                        <span className="text-foreground">
                          {" "}
                          +{remainingCount} more
                        </span>
                      )}
                    </>
                  ) : (
                    "Recipients"
                  )}
                </p>
              </div>

              <Separator />

              <div className="space-y-3 text-sm text-muted-foreground">
                <p>Hey!</p>
                <p>
                  You have been invited to view the{" "}
                  <span className="font-semibold text-foreground">
                    {dataroomName}
                  </span>{" "}
                  dataroom on{" "}
                  <span className="font-semibold text-foreground">
                    Papermark
                  </span>
                  .
                  <br />
                  The invitation was sent by{" "}
                  <span className="font-semibold text-foreground">
                    {senderEmail}
                  </span>
                  .
                </p>
                {customMessage.length > 0 ? (
                  <p className="whitespace-pre-wrap text-foreground">
                    {customMessage}
                  </p>
                ) : null}
                <div className="my-4 rounded border border-gray-200 bg-black px-5 py-3 text-center text-xs font-semibold text-white">
                  View the dataroom
                </div>
                <p className="text-xs">
                  or copy and paste this URL into your browser:
                  <br />
                  <span className="break-all text-foreground">
                    {selectedLink
                      ? `https://papermark.com/view/${selectedLink.slug ?? selectedLink.id}`
                      : "https://papermark.com/view/..."}
                  </span>
                </p>
                <Separator className="my-2" />
                <p className="text-xs">
                  © {new Date().getFullYear()} Papermark, Inc. All rights
                  reserved.
                </p>
                <p className="text-xs">
                  This email was intended for{" "}
                  <span className="text-foreground">
                    {currentRecipients.length > 0
                      ? currentRecipients[0]
                      : "recipient@example.com"}
                  </span>
                  . If you were not expecting this email, you can ignore this
                  email.
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              type="button"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            {canSend ? (
              <Button
                onClick={handleSend}
                loading={loading}
                disabled={
                  isOverLimit ||
                  (groupId
                    ? !selectedLinkId || loading || recipientCount === 0
                    : loading || recipientCount === 0)
                }
              >
                {loading
                  ? "Sending invitations..."
                  : `Send ${recipientCount} invitation${recipientCount !== 1 ? "s" : ""}`}
              </Button>
            ) : (
              <UpgradePlanModal
                clickedPlan={PlanEnum.DataRoomsPlus}
                trigger="invite_modal_upgrade"
                highlightItem={["email-invite"]}
              >
                <Button>
                  <CrownIcon className="h-4 w-4" />
                  Upgrade to send invites
                </Button>
              </UpgradePlanModal>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
