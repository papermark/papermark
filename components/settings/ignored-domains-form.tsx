import { useEffect, useMemo, useState } from "react";

import { useTeam } from "@/context/team-context";
import { toast } from "sonner";
import useSWR from "swr";

import { fetcher, sanitizeList } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export default function IgnoredDomainsForm() {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: ignoredDomains, mutate } = useSWR<string[]>(
    teamId ? `/api/teams/${teamId}/ignored-domains` : null,
    fetcher,
  );

  const [domainsInput, setDomainsInput] = useState("");
  const [initialDomainsInput, setInitialDomainsInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (ignoredDomains) {
      const val = ignoredDomains.join("\n");
      setDomainsInput(val);
      setInitialDomainsInput(val);
    }
  }, [ignoredDomains]);

  const allEnteredDomains = domainsInput
    .split("\n")
    .map((d) => d.trim())
    .filter(Boolean);
  const validDomains = sanitizeList(domainsInput, "domain");
  const invalidDomains = allEnteredDomains.filter(
    (d) => !validDomains.includes(d.toLowerCase()),
  );

  const saveDisabled = useMemo(() => {
    return (
      isSaving ||
      domainsInput === initialDomainsInput ||
      invalidDomains.length > 0
    );
  }, [isSaving, domainsInput, initialDomainsInput, invalidDomains]);

  const handleSave = async () => {
    setIsSaving(true);
    const domains = sanitizeList(domainsInput, "domain");

    const promise = fetch(`/api/teams/${teamId}/ignored-domains`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ domains }),
    }).then(async (res) => {
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error || "Failed to update ignored domains.");
      }
      await mutate();
      return res.json();
    });

    toast.promise(promise, {
      loading: "Saving ignored domains...",
      success: "Ignored domains saved!",
      error: (err) => err.message,
    });

    try {
      await promise;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ignored Domains for Notifications</CardTitle>
        <CardDescription>
          No one on the team will be notified when a visitor from these domains
          views a link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Textarea
          className="focus:ring-inset"
          rows={5}
          placeholder={`Enter one domain per line, e.g.
@company.io
@example.com`}
          value={domainsInput}
          onChange={(e) => setDomainsInput(e.target.value)}
        />
        {invalidDomains.length > 0 && (
          <p className="mt-2 text-sm text-destructive">
            The following entries are not valid domains and will be ignored:{" "}
            {invalidDomains.join(", ")}
          </p>
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-between rounded-b-lg border-t bg-muted px-6 py-3">
        <p className="text-sm text-muted-foreground transition-colors">
          Add domains to prevent notifications from internal views.
        </p>
        <Button onClick={handleSave} loading={isSaving} disabled={saveDisabled}>
          Save Changes
        </Button>
      </CardFooter>
    </Card>
  );
}
