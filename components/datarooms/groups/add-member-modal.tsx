import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { toast } from "sonner";
import { mutate } from "swr";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { useAnalytics } from "@/lib/analytics";

export function AddGroupMemberModal({
  dataroomId,
  groupId,
  open,
  setOpen,
  children,
}: {
  dataroomId: string;
  groupId: string;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  children?: React.ReactNode;
}) {
  const [inputValue, setInputValue] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const analytics = useAnalytics();

  // Email validation regex pattern
  const validateEmail = (email: string) => {
    return email.match(
      /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
    );
  };

  // Domain validation regex pattern
  const validateDomain = (domain: string) => {
    return domain.match(/^@([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const inputValue = e.target.value;
    setInputValue(inputValue);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const inputs = Array.from(
      new Set(
        inputValue
          .split(/[,;\n\r\t]+/)
          .map((input) => input.trim().toLowerCase())
          .filter((input) => input.length > 0),
      ),
    );

    if (inputs.length === 0) return;

    // Separate domains and emails
    const domains = inputs.filter((input) => input.startsWith("@"));
    const emails = inputs.filter((input) => !input.startsWith("@"));

    // validate emails
    const invalidEmails = emails.filter((email) => !validateEmail(email));
    if (invalidEmails.length > 0) {
      toast.error(
        `Found invalid email${invalidEmails.length > 1 ? "s" : ""}: ${invalidEmails
          .slice(0, 3)
          .join(", ")}${invalidEmails.length > 3 ? ", ..." : ""}`,
      );
      return;
    }

    // validate domains
    const invalidDomains = domains.filter((domain) => !validateDomain(domain));
    if (invalidDomains.length > 0) {
      toast.error(
        `Found invalid domain${invalidDomains.length > 1 ? "s" : ""}: ${invalidDomains
          .slice(0, 3)
          .join(", ")}${invalidDomains.length > 3 ? ", ..." : ""}. Domains should be in format @example.org`,
      );
      return;
    }

    setLoading(true);

    // POST request with emails and domains
    const response = await fetch(
      `/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}/members`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          emails,
          domains,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      setLoading(false);
      setOpen(false);
      toast.error(error.message || "Failed to add group members.");
      return;
    }

    analytics.capture("Dataroom Group Member Added", {
      emailCount: emails.length,
      domainCount: domains.length,
      teamId: teamId,
      dataroomId: dataroomId,
      groupId: groupId,
    });

    mutate(`/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}`);

    toast.success("Group members added successfully!");
    setOpen(false);
    setInputValue("");
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader className="text-start">
          <DialogTitle>Add members</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Label htmlFor="email">Email addresses or domains</Label>
          <div className="flex flex-col gap-2 py-2 text-sm">
            <Textarea
              value={inputValue}
              onChange={handleInputChange}
              rows={5}
              id="email"
              placeholder={`jane@acme.com, john@acme.com; @example.org
or one entry per line`}
              className="flex-1 bg-muted"
              autoComplete="off"
            />
            <small className="text-xs text-muted-foreground">
              Separate multiple email addresses or domains with a comma,
              semicolon, or new line. For domains, use the format
              {" "}
              <code>@example.org</code>.
            </small>
          </div>

          <DialogFooter>
            <Button type="submit" className="mt-6 h-9 w-full" loading={loading}>
              {loading ? "Adding members..." : "Add members"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
