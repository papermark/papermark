"use client";

import { useRouter } from "next/router";

import { useEffect, useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { ArrowLeft, Check } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { newId } from "@/lib/id-helper";
import { usePlan } from "@/lib/swr/use-billing";

import AppLayout from "@/components/layouts/app";
import { SettingsHeader } from "@/components/settings/settings-header";
import Copy from "@/components/shared/icons/copy";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UpgradeButton } from "@/components/ui/upgrade-button";

interface WebhookEvent {
  id: string;
  label: string;
  value: string;
}

export const teamEvents: WebhookEvent[] = [
  {
    id: "document-created",
    label: "Document Created",
    value: "document.created",
  },
  {
    id: "document-updated",
    label: "Document Updated",
    value: "document.updated",
  },
  {
    id: "document-deleted",
    label: "Document Deleted",
    value: "document.deleted",
  },
  {
    id: "dataroom-created",
    label: "Dataroom Created",
    value: "dataroom.created",
  },
];

export const documentEvents: WebhookEvent[] = [
  { id: "link-created", label: "Link Created", value: "link.created" },
  { id: "link-updated", label: "Link Updated", value: "link.updated" },
];

export const linkEvents: WebhookEvent[] = [
  { id: "link-viewed", label: "Link Viewed", value: "link.viewed" },
  { id: "link-downloaded", label: "Link Downloaded", value: "link.downloaded" },
];

const formSchema = z.object({
  name: z
    .string()
    .min(3, "Please provide a webhook name with at least 3 characters."),
  url: z.string().url("Please enter a valid URL."),
  secret: z.string(),
  triggers: z
    .array(z.string())
    .min(1, "Select at least one event trigger."),
});

export default function NewWebhook() {
  const router = useRouter();
  const teamInfo = useTeam();
  const { isFree, isPro, isTrial } = usePlan();
  const teamId = teamInfo?.currentTeam?.id;

  const [isLoading, setIsLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    url: "",
    secret: "",
    triggers: [] as string[],
  });

  useEffect(() => {
    const generatedSecret = newId("webhookSecret");
    setFormData((prev) => ({ ...prev, secret: generatedSecret }));
  }, []);

  const createWebhook = async () => {
    if ((isFree || isPro) && !isTrial) {
      return;
    }

    try {
      setIsLoading(true);
      const result = formSchema.safeParse(formData);
      if (!result.success) {
        const errors = result.error.flatten().fieldErrors;
        Object.values(errors).forEach((errorMessages) => {
          if (errorMessages) {
            toast.error(errorMessages[0]);
          }
        });
        return;
      }
      const response = await fetch(`/api/teams/${teamId}/webhooks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error("Failed to create webhook");
      }

      toast.success("Webhook created successfully");
      router.push("/settings/webhooks");
    } catch (error) {
      toast.error("Failed to create webhook");
    } finally {
      setIsLoading(false);
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

        <div className="w-full max-w-3xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              createWebhook();
            }}
            className="space-y-8"
          >
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <p className="text-sm text-muted-foreground">
                This name will be used to identify the webhook in the dashboard.
              </p>
              <Input
                id="name"
                placeholder="My Webhook"
                value={formData.name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                data-1p-ignore
                autoComplete="off"
                autoFocus
              />
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Events</Label>
                <p className="text-sm text-muted-foreground">
                  Select the events the webhook will listen to. At least one
                  must be selected.
                </p>
              </div>

              <Card className="dark:bg-muted">
                <CardContent className="py-6">
                  <div className="space-y-6">
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
                                checked={formData.triggers.includes(
                                  event.value,
                                )}
                                disabled={event.value !== "document.created"}
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
                                checked={formData.triggers.includes(
                                  event.value,
                                )}
                                disabled={event.value !== "link.created"}
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
                                checked={formData.triggers.includes(
                                  event.value,
                                )}
                                disabled={event.value === "link.downloaded"}
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
                </CardContent>
              </Card>
            </div>

            <div className="space-y-2">
              <Label htmlFor="url">Endpoint</Label>
              <p className="text-sm text-muted-foreground">
                Webhooks events will be sent as{" "}
                <span className="rounded-sm bg-muted px-1 font-mono ring-1 ring-muted-foreground/30">
                  POST
                </span>{" "}
                request to this URL.
              </p>
              <Input
                id="url"
                placeholder="https://your-domain.com/webhooks"
                value={formData.url}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, url: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="secret">Signing Secret</Label>
              <p className="text-sm text-muted-foreground">
                This secret will be used to sign the webhook payload.
              </p>
              <div className="relative">
                <Input
                  id="secret"
                  placeholder="whsec_1234567890abcdef"
                  type="text"
                  value={formData.secret}
                  readOnly
                  className="pr-10 font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                  onClick={() => {
                    navigator.clipboard.writeText(formData.secret);
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

            <div className="flex space-x-4">
              {(isFree || isPro) && !isTrial ? (
                <UpgradeButton
                  text="Save Webhook"
                  clickedPlan={PlanEnum.Business}
                  trigger="create_webhook"
                  highlightItem={["webhooks"]}
                  type="submit"
                  disabled={isLoading || formData.triggers.length === 0}
                  key="create-webhook"
                />
              ) : (
                <Button
                  type="submit"
                  disabled={isLoading || formData.triggers.length === 0}
                >
                  {isLoading ? "Creating..." : "Create Webhook"}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="dark:bg-transparent dark:hover:bg-muted"
                onClick={() => router.push("/settings/webhooks")}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      </main>
    </AppLayout>
  );
}
