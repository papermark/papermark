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

export default function GlobalBlockListForm() {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: blockList, mutate } = useSWR<string[]>(
    teamId ? `/api/teams/${teamId}/global-block-list` : null,
    fetcher,
  );

  const [blockListInput, setBlockListInput] = useState("");
  const [initialBlockListInput, setInitialBlockListInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (blockList) {
      const val = blockList.join("\n");
      setBlockListInput(val);
      setInitialBlockListInput(val);
    }
  }, [blockList]);

  const allEntered = blockListInput
    .split("\n")
    .map((d) => d.trim())
    .filter(Boolean);
  const validEntries = sanitizeList(blockListInput, "both");
  const invalidEntries = allEntered.filter(
    (d) => !validEntries.includes(d.toLowerCase()),
  );

  const saveDisabled = useMemo(() => {
    return (
      isSaving ||
      blockListInput === initialBlockListInput ||
      invalidEntries.length > 0
    );
  }, [isSaving, blockListInput, initialBlockListInput, invalidEntries]);

  const handleSave = async () => {
    setIsSaving(true);
    const entries = sanitizeList(blockListInput, "both");

    const promise = fetch(`/api/teams/${teamId}/global-block-list`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ blockList: entries }),
    }).then(async (res) => {
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error || "Failed to update block list.");
      }
      await mutate();
      return res.json();
    });

    toast.promise(promise, {
      loading: "Saving block list...",
      success: "Block list saved!",
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
        <CardTitle>Global Block List</CardTitle>
        <CardDescription>
          Visitors with these emails or domains will be{" "}
          <b>blocked from all links</b> in your team. Use{" "}
          <code>@domain.com</code> for domains or full email addresses.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Textarea
          className="focus:ring-inset"
          rows={5}
          placeholder={`Enter one email or domain per line, e.g.\n@company.io\nuser@example.com`}
          value={blockListInput}
          onChange={(e) => setBlockListInput(e.target.value)}
        />
        {invalidEntries.length > 0 && (
          <p className="mt-2 text-sm text-destructive">
            The following entries are not valid and will be ignored:{" "}
            {invalidEntries.join(", ")}
          </p>
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-between rounded-b-lg border-t bg-muted px-6 py-3">
        <p className="text-sm text-muted-foreground transition-colors">
          Add emails or domains to block access to all links.
        </p>
        <Button onClick={handleSave} loading={isSaving} disabled={saveDisabled}>
          Save Changes
        </Button>
      </CardFooter>
    </Card>
  );
}
