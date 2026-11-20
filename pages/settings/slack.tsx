import { useRouter } from "next/router";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useTeam } from "@/context/team-context";
import {
  CircleHelpIcon,
  Hash,
  RefreshCwIcon,
  Settings,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";

import { useAnalytics } from "@/lib/analytics";
import {
  SlackChannelConfig,
  SlackIntegration,
} from "@/lib/integrations/slack/types";
import { useSlackChannels } from "@/lib/swr/use-slack-channels";
import { useSlackIntegration } from "@/lib/swr/use-slack-integration";

import AppLayout from "@/components/layouts/app";
import { SettingsHeader } from "@/components/settings/settings-header";
import SlackSettingsSkeleton from "@/components/settings/slack-settings-skeleton";
import { SlackIcon } from "@/components/shared/icons/slack-icon";
import { CommonAlertDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select-v2";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { BadgeTooltip } from "@/components/ui/tooltip";

export default function SlackSettings() {
  const router = useRouter();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const [connecting, setConnecting] = useState(false);
  const [isChannelPopoverOpen, setIsChannelPopoverOpen] = useState(false);
  const [pendingChannelUpdate, setPendingChannelUpdate] = useState(false);
  const [refreshingChannels, setRefreshingChannels] = useState(false);
  const analytics = useAnalytics();

  // Use SWR hook for integration data
  const {
    integration,
    error: integrationError,
    loading: loadingIntegration,
    mutate: mutateIntegration,
  } = useSlackIntegration({
    enabled: !!teamId,
  });

  const {
    channels,
    loading: loadingChannels,
    error: channelsError,
    mutate: mutateChannels,
    refresh: refreshChannels,
  } = useSlackChannels({
    enabled: !!integration,
  });

  const ChannelIcon = useMemo(
    () => <Hash className="h-4 w-4 text-muted-foreground" />,
    [],
  );

  const filteredChannels = useMemo(
    () => channels.filter((channel) => !channel.is_archived),
    [channels],
  );

  const channelOptions = useMemo(
    () =>
      filteredChannels.map((channel) => ({
        value: channel.id,
        label: channel.name,
        icon: ChannelIcon,
        meta: {
          color: "slate",
          description: channel.is_private
            ? "Private channel"
            : "Public channel",
        },
      })),
    [filteredChannels, ChannelIcon],
  );

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;

    if (router.query.success) {
      toast.success("Slack integration connected successfully!");
      mutateIntegration();

      // Track successful connection on client side
      analytics.capture("Slack Connected", {
        source: "settings_page",
        team_id: teamId,
      });

      if (router.query.warning) {
        toast.warning(`Warning: ${router.query.warning}`);
      }

      timeoutId = setTimeout(() => {
        router.replace("/settings/slack", undefined, { shallow: true });
      }, 100);
    } else if (router.query.error) {
      toast.error(`Failed to connect Slack: ${router.query.error}`);

      // Track failed connection on client side
      analytics.capture("Slack Connection Failed", {
        source: "settings_page",
        team_id: teamId,
        error: router.query.error,
      });

      timeoutId = setTimeout(() => {
        router.replace("/settings/slack", undefined, { shallow: true });
      }, 100);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [router.query, mutateIntegration, analytics, teamId]);

  const handleConnect = async () => {
    if (!teamId) return;

    setConnecting(true);
    analytics.capture("Slack Connect Button Clicked", {
      source: "settings_page",
      team_id: teamId,
    });

    try {
      const response = await fetch(
        `/api/integrations/slack/oauth/authorize?teamId=${teamId}`,
      );
      const data = await response.json();

      if (response.ok) {
        // Redirect to Slack OAuth
        window.location.href = data.oauthUrl;
      } else {
        toast.error(data.error || "Failed to start OAuth process");
      }
    } catch (error) {
      console.error("Error starting OAuth:", error);
      toast.error("Failed to start OAuth process");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    const disconnectPromise = async () => {
      const response = await fetch(`/api/teams/${teamId}/integrations/slack`, {
        method: "DELETE",
      });

      if (response.ok) {
        mutateIntegration(undefined, false);
      } else {
        const data = await response.json();
        throw new Error(data.error || "Failed to disconnect Slack");
      }
    };

    toast.promise(disconnectPromise(), {
      loading: "Disconnecting Slack integration...",
      success: "Slack integration disconnected successfully",
      error: "Failed to disconnect Slack integration. Please try again.",
    });
  };

  const handleChannelsUpdate = useCallback(
    async (selectedChannelIds: string[]) => {
      if (!teamId || !integration) return;
      setIsChannelPopoverOpen(false);

      const updatePromise = async () => {
        const validChannelIds = selectedChannelIds.filter((id) =>
          channels.some((channel) => channel.id === id),
        );

        if (validChannelIds.length !== selectedChannelIds.length) {
          throw new Error("Some selected channels are no longer available");
        }

        const updatedChannels = validChannelIds.reduce(
          (acc, channelId) => {
            const channel = channels.find((c) => c.id === channelId);
            if (channel) {
              acc[channelId] = {
                id: channelId,
                name: channel.name,
                enabled: true,
                notificationTypes: [
                  "document_view",
                  "dataroom_access",
                  "document_download",
                ],
              } as SlackChannelConfig;
            }
            return acc;
          },
          {} as Record<string, SlackChannelConfig>,
        );
        const previousIntegration = integration;
        mutateIntegration(
          {
            ...integration,
            configuration: {
              enabledChannels: updatedChannels,
            },
          },
          false,
        );

        try {
          const requestBody = {
            enabledChannels: updatedChannels,
          };

          const startTime = performance.now();
          const response = await fetch(
            `/api/teams/${teamId}/integrations/slack/channels`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
            },
          );
          const endTime = performance.now();

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(
              errorData.error || "Failed to update channel settings",
            );
          }

          const result = await response.json();

          // Handle the simplified response
          if (result.success) {
            mutateIntegration(
              {
                ...integration,
                configuration: {
                  enabledChannels: result.enabledChannels,
                },
                updatedAt: result.updatedAt,
              },
              false,
            );
          } else {
            // Fallback for full integration response
            mutateIntegration(result, false);
          }

          mutateChannels();

          return "Channel settings updated successfully";
        } catch (error) {
          // Rollback on error
          mutateIntegration(previousIntegration, false);
          throw error;
        }
      };

      toast.promise(updatePromise(), {
        loading: "Updating channel settings...",
        success: (message) => message,
        error: (error) => error.message || "Failed to update channel settings",
      });
    },
    [
      teamId,
      integration,
      channels,
      mutateChannels,
      mutateIntegration,
      setIsChannelPopoverOpen,
    ],
  );

  const debouncedChannelsUpdate = (selectedChannelIds: string[]) => {
    setPendingChannelUpdate(true);
    handleChannelsUpdate(selectedChannelIds).finally(() => {
      setPendingChannelUpdate(false);
    });
  };

  const handleIntegrationToggle = useCallback(
    async (checked: boolean) => {
      if (!teamId || !integration) return;

      const togglePromise = async () => {
        const previousState = integration.enabled;

        // Optimistic update
        mutateIntegration(
          {
            ...integration,
            enabled: checked,
          },
          false,
        );

        const response = await fetch(
          `/api/teams/${teamId}/integrations/slack`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ enabled: checked }),
          },
        );

        if (!response.ok) {
          // Rollback on error
          mutateIntegration(
            {
              ...integration,
              enabled: previousState,
            },
            false,
          );
          throw new Error("Failed to update notification settings");
        }

        const updatedIntegration: SlackIntegration = await response.json();
        mutateIntegration(updatedIntegration, false);

        return checked
          ? "Slack notifications enabled"
          : "Slack notifications disabled";
      };

      toast.promise(togglePromise(), {
        loading: "Updating notification settings...",
        success: (message) => message,
        error: "Failed to update notification settings",
      });
    },
    [teamId, integration, mutateIntegration],
  );

  const handleRefreshChannels = useCallback(async () => {
    setRefreshingChannels(true);
    try {
      await refreshChannels();
      toast.success("Channel list refreshed");
    } catch (error) {
      toast.error("Failed to refresh channel list");
    } finally {
      setRefreshingChannels(false);
    }
  }, [refreshChannels]);

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />

        <div>
          {loadingIntegration ? (
            <SlackSettingsSkeleton />
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between md:mb-8 lg:mb-12">
                <div className="space-y-1">
                  <h3 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
                    <SlackIcon className="h-6 w-6" />
                    Slack Integration
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Receive notifications in your Slack channels when documents
                    are viewed or accessed
                  </p>
                </div>
                {!integration ? (
                  <Button onClick={handleConnect} disabled={connecting}>
                    {connecting ? (
                      <>
                        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                        Connecting...
                      </>
                    ) : (
                      <>
                        <SlackIcon className="mr-2 h-4 w-4" />
                        Connect to Slack
                      </>
                    )}
                  </Button>
                ) : (
                  <CommonAlertDialog
                    title="Disconnect Slack Integration"
                    description="Are you sure you want to disconnect Slack? This will remove all notification settings and stop sending notifications to your Slack channels."
                    action="Disconnect"
                    actionUpdate="Disconnecting"
                    onAction={handleDisconnect}
                  />
                )}
              </div>
              {!integration ? (
                // Not connected state
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <SlackIcon className="h-5 w-5" />
                      Connect Slack
                    </CardTitle>
                    <CardDescription>
                      Connect your Slack workspace to receive real-time
                      notifications about document activity.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex items-center space-x-2">
                        <Switch disabled={true} />
                        <span className="text-sm font-medium">
                          Slack notifications
                        </span>
                        <Badge variant="secondary">Not connected</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                // Connected state
                <div className="space-y-6">
                  {/* General Settings */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Settings className="h-5 w-5" />
                        General Settings
                      </CardTitle>
                      <CardDescription>
                        Connected to {integration.credentials.team.name}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-6">
                        {/* Slack Notification Toggle */}
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <SlackIcon className="h-5 w-5" />
                              <h4 className="font-medium">
                                Slack notification
                              </h4>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Receive notifications in your Slack channels
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={integration.enabled}
                              disabled={false}
                              onCheckedChange={handleIntegrationToggle}
                            />
                          </div>
                        </div>

                        <Separator />
                        <div className="space-y-3">
                          <div className="flex items-start justify-between">
                            <div>
                              <Label className="flex items-center gap-2 text-sm font-medium">
                                Slack channel(s) *
                                <BadgeTooltip
                                  content="Get instant notifications in Slack when someone views, downloads, or interacts with your documents and datarooms"
                                  key="channel_tooltip"
                                >
                                  <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
                                </BadgeTooltip>
                              </Label>
                              <p className="text-sm text-muted-foreground">
                                Select the Slack channel(s) where you want to
                                receive notifications.
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleRefreshChannels}
                              disabled={refreshingChannels || loadingChannels}
                              className="shrink-0"
                            >
                              <RefreshCwIcon
                                className={`mr-1 h-4 w-4 ${refreshingChannels ? "animate-spin" : ""}`}
                              />
                              Refresh
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            To add Papermark to a private channel, type{" "}
                            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                              /invite @Papermark
                            </code>{" "}
                            in that channel first, then refresh the list.
                          </p>

                          {!integration ? (
                            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600 dark:border-gray-600 dark:border-t-gray-400"></div>
                              <span>Loading integration...</span>
                            </div>
                          ) : channelsError ? (
                            <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
                              <div className="flex items-center gap-2">
                                <XCircleIcon className="h-4 w-4" />
                                <div>
                                  <p className="font-medium">
                                    Failed to load channels
                                  </p>
                                </div>
                              </div>
                            </div>
                          ) : loadingChannels ? (
                            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600 dark:border-gray-600 dark:border-t-gray-400"></div>
                              <span>Loading channels...</span>
                            </div>
                          ) : channels.length === 0 ? (
                            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                              <Hash className="h-4 w-4" />
                              <div>
                                <p className="font-medium">
                                  No channels available
                                </p>
                              </div>
                            </div>
                          ) : (
                            <MultiSelect
                              loading={false}
                              options={channelOptions}
                              value={Object.keys(
                                integration.configuration?.enabledChannels ||
                                  {},
                              )}
                              setIsPopoverOpen={setIsChannelPopoverOpen}
                              isPopoverOpen={isChannelPopoverOpen}
                              onValueChange={debouncedChannelsUpdate}
                              placeholder={
                                pendingChannelUpdate
                                  ? "Saving changes..."
                                  : "Select channels..."
                              }
                              maxCount={5}
                              searchPlaceholder="Search channels..."
                              triggerIcon={
                                <Hash className="h-4 w-4 text-muted-foreground" />
                              }
                            />
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </AppLayout>
  );
}
