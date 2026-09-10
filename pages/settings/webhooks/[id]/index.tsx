import { useRouter } from "next/router";

import { useEffect, useState } from "react";

import { useTeam } from "@/context/team-context";
import { Webhook } from "@prisma/client";
import { ArrowLeft, Check, Copy, WebhookIcon } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import z from "zod";

import { usePlan } from "@/lib/swr/use-billing";
import { cn, fetcher } from "@/lib/utils";

import AppLayout from "@/components/layouts/app";
import { SettingsHeader } from "@/components/settings/settings-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WebhookEventList } from "@/components/webhooks/webhook-events";

import { documentEvents, linkEvents, teamEvents } from "../new";

type WebhookFormData = {
  name: string;
  triggers: string[];
};

export default function WebhookDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { currentTeamId: teamId } = useTeam();
  const { isFree, isPro, isTrial } = usePlan();
  const [isEditing, setIsEditing] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [formData, setFormData] = useState<WebhookFormData>({
    name: "",
    triggers: [],
  });

  const { data: webhook, mutate } = useSWR<Webhook>(
    teamId && id ? `/api/teams/${teamId}/webhooks/${id}` : null,
    fetcher,
  );

  const { data: webhookEvents } = useSWR<any[]>(
    teamId && id ? `/api/teams/${teamId}/webhooks/${id}/events` : null,
    fetcher,
    {
      keepPreviousData: true,
    },
  );

  useEffect(() => {
    if (webhook && !isEditing) {
      setFormData({
        name: webhook.name,
        triggers: webhook.triggers as string[],
      });
    }
  }, [isEditing, webhook]);

  const handleUpdate = async () => {
    if ((isFree || isPro) && !isTrial) {
      toast.error("This feature is not available on your plan");
      return;
    }

    try {
      const webhookId = z.string().cuid().parse(id);
      const response = await fetch(
        `/api/teams/${teamId}/webhooks/${webhookId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        },
      );

      if (!response.ok) throw new Error("Failed to update webhook");

      await mutate();
      setIsEditing(false);
      toast.success("Webhook updated successfully");
    } catch (error) {
      toast.error("Failed to update webhook");
    }
  };

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />

        <Button
          variant="ghost"
          size="sm"
          className="mb-2 flex items-center gap-2 pl-0 text-muted-foreground"
          onClick={() => router.push("/settings/webhooks")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to webhooks
        </Button>

        <div>
          <div className="mb-4 flex items-center justify-between md:mb-8 lg:mb-12">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold tracking-tight text-foreground">
                {webhook?.name}
              </h3>
              <p className="flex flex-row items-center gap-2 font-mono text-sm text-muted-foreground">
                {webhook?.url}
              </p>
            </div>
          </div>

          <Tabs defaultValue="events" className="space-y-4">
            <TabsList>
              <TabsTrigger value="events">Events</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="events" className="space-y-4">
              {!webhookEvents || webhookEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center space-y-4 rounded-lg border border-dashed py-12">
                  <div className="rounded-full bg-gray-100 p-3">
                    <WebhookIcon className="h-6 w-6 text-gray-600" />
                  </div>
                  <div className="text-center">
                    <h3 className="font-medium">No webhook events yet</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Events will appear here when they are triggered
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <WebhookEventList events={webhookEvents} />
                </div>
              )}
            </TabsContent>

            <TabsContent value="settings" className="space-y-4">
              <Card className="p-6 dark:bg-transparent">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      value={isEditing ? formData.name : webhook?.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      disabled={!isEditing}
                      className={cn(
                        "disabled:cursor-not-allowed disabled:opacity-60",
                        isEditing && "cursor-text",
                      )}
                    />
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1">
                      <Label>Events</Label>
                      <p className="text-sm text-muted-foreground">
                        Select the events the webhook will listen to. At least
                        one must be selected.
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-8">
                      <div className="space-y-4">
                        <h4 className="text-sm font-light">Team Events</h4>
                        <div className="space-y-4">
                          {teamEvents.map((event) => (
                            <div
                              key={event.id}
                              className="flex items-center space-x-2"
                            >
                              <Checkbox
                                id={event.id}
                                checked={formData?.triggers?.includes(
                                  event.value,
                                )}
                                onCheckedChange={(checked) => {
                                  setFormData((prev) => ({
                                    ...prev,
                                    triggers: checked
                                      ? [...prev.triggers, event.value]
                                      : prev.triggers.filter(
                                          (e) => e !== event.value,
                                        ),
                                  }));
                                }}
                                disabled={
                                  !isEditing ||
                                  event.value !== "document.created"
                                }
                              />
                              <Label htmlFor={event.id}>{event.label}</Label>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h4 className="text-sm font-light">Document Events</h4>
                        <div className="space-y-4">
                          {documentEvents.map((event) => (
                            <div
                              key={event.id}
                              className="flex items-center space-x-2"
                            >
                              <Checkbox
                                id={event.id}
                                checked={formData?.triggers.includes(
                                  event.value,
                                )}
                                onCheckedChange={(checked) => {
                                  setFormData((prev) => ({
                                    ...prev,
                                    triggers: checked
                                      ? [...prev.triggers, event.value]
                                      : prev.triggers.filter(
                                          (e) => e !== event.value,
                                        ),
                                  }));
                                }}
                                disabled={
                                  !isEditing || event.value !== "link.created"
                                }
                              />
                              <Label htmlFor={event.id}>{event.label}</Label>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h4 className="text-sm font-light">Link Events</h4>
                        <div className="space-y-4">
                          {linkEvents.map((event) => (
                            <div
                              key={event.id}
                              className="flex items-center space-x-2"
                            >
                              <Checkbox
                                id={event.id}
                                checked={formData?.triggers.includes(
                                  event.value,
                                )}
                                disabled={
                                  !isEditing ||
                                  event.value === "link.downloaded"
                                }
                                onCheckedChange={(checked) => {
                                  setFormData((prev) => ({
                                    ...prev,
                                    triggers: checked
                                      ? [...prev.triggers, event.value]
                                      : prev.triggers.filter(
                                          (e) => e !== event.value,
                                        ),
                                  }));
                                }}
                              />
                              <Label htmlFor={event.id}>{event.label}</Label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="url">Endpoint</Label>
                      <p className="text-sm text-muted-foreground">
                        Webhooks events will be sent as{" "}
                        <span className="rounded-sm bg-muted px-1 font-mono ring-1 ring-muted-foreground/30">
                          POST
                        </span>{" "}
                        request to this URL. This cannot be changed after
                        creation.
                      </p>
                    </div>
                    <div className="rounded-md border border-input bg-muted px-3 py-2 font-mono text-sm text-muted-foreground">
                      {webhook?.url}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="secret">Signing Secret</Label>
                      <p className="text-sm text-muted-foreground">
                        This secret will be used to sign the webhook payload.
                        This cannot be changed after creation.
                      </p>
                    </div>
                    <div className="relative">
                      <div className="rounded-md border border-input bg-muted px-3 py-2 font-mono text-sm text-muted-foreground">
                        {webhook?.secret}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                        onClick={() => {
                          navigator.clipboard.writeText(webhook?.secret || "");
                          toast.success("Copied to clipboard!");
                          setIsCopied(true);
                          setTimeout(() => setIsCopied(false), 2000);
                        }}
                      >
                        {isCopied ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label>Webhook ID</Label>
                      <p className="text-sm text-muted-foreground">
                        This ID can be used to identify the webhook or for
                        debugging purposes.
                      </p>
                    </div>
                    <p className="font-mono text-sm text-muted-foreground">
                      {webhook?.pId}
                    </p>
                  </div>

                  <div className="pt-4">
                    {isEditing ? (
                      <div className="flex gap-2">
                        <Button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleUpdate();
                          }}
                        >
                          Save Changes
                        </Button>
                        <Button
                          variant="outline"
                          className="dark:bg-transparent dark:hover:bg-muted"
                          onClick={() => {
                            if (webhook) {
                              setFormData({
                                name: webhook.name,
                                triggers: webhook.triggers as string[],
                              });
                            }
                            setIsEditing(false);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if ((isFree || isPro) && !isTrial) {
                            toast.error(
                              "This feature is not available on your plan",
                            );
                            return;
                          }
                          setIsEditing(true);
                        }}
                      >
                        Click to edit webhook
                      </Button>
                    )}
                  </div>
                </div>
              </Card>

              <Card className="border-destructive p-6">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-lg font-medium text-destructive">
                      Delete Webhook
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Once you delete a webhook, there is no going back. This
                      action cannot be undone.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      if (
                        confirm(
                          "Are you sure you want to delete this webhook? This action cannot be undone.",
                        )
                      ) {
                        try {
                          const webhookId = z.string().cuid().parse(id);
                          const response = await fetch(
                            `/api/teams/${teamId}/webhooks/${webhookId}`,
                            {
                              method: "DELETE",
                            },
                          );

                          if (!response.ok)
                            throw new Error("Failed to delete webhook");

                          toast.success("Webhook deleted successfully");
                          router.push("/settings/webhooks");
                        } catch (error) {
                          toast.error("Failed to delete webhook");
                        }
                      }
                    }}
                  >
                    Delete Webhook
                  </Button>
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </AppLayout>
  );
}
