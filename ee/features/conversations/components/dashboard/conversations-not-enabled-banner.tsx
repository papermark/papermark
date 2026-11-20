import Link from "next/link";

import { useEffect, useState } from "react";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { toast } from "sonner";
import z from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

interface ConversationsNotEnabledBannerProps {
  dataroomId: string;
  teamId: string;
  isConversationsEnabled: boolean;
  onConversationsToggled?: (enabled: boolean) => void;
  isPlanWithConversations?: boolean;
}

export function ConversationsNotEnabledBanner({
  dataroomId,
  teamId,
  isConversationsEnabled,
  onConversationsToggled,
  isPlanWithConversations,
}: ConversationsNotEnabledBannerProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLocallyEnabled, setIsLocallyEnabled] = useState(
    isConversationsEnabled,
  );
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Check if banner should be collapsed or dismissed on initial load
  useEffect(() => {
    // Check for dismissed state first
    const isDismissedLocal =
      localStorage.getItem(
        `dataroom-${dataroomId}-conversations-banner-dismissed`,
      ) === "true";
    if (isDismissedLocal) {
      setIsDismissed(true);
      return;
    }

    // Check for collapsed state
    const shouldCollapse =
      localStorage.getItem(
        `dataroom-${dataroomId}-conversations-banner-collapsed`,
      ) === "true";
    if (shouldCollapse) {
      setIsCollapsed(true);
    }
  }, [dataroomId]);

  // Update local state when prop changes
  useEffect(() => {
    setIsLocallyEnabled(isConversationsEnabled);
  }, [isConversationsEnabled]);

  // Auto-enable conversations for plans that include them
  useEffect(() => {
    if (isPlanWithConversations && !isConversationsEnabled && !isProcessing) {
      handleToggleConversations(true, { silent: true });
    }
  }, [isPlanWithConversations, isConversationsEnabled]);

  // Save collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem(
      `dataroom-${dataroomId}-conversations-banner-collapsed`,
      isCollapsed.toString(),
    );
  }, [isCollapsed, dataroomId]);

  const handleToggleConversations = async (
    newValue: boolean,
    { silent = false }: { silent?: boolean } = {},
  ) => {
    setIsProcessing(true);
    try {
      const dataroomIdParsed = z.string().cuid().parse(dataroomId);
      const teamIdParsed = z.string().cuid().parse(teamId);

      const response = await fetch(
        `/api/teams/${teamIdParsed}/datarooms/${dataroomIdParsed}/conversations/toggle-conversations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ enabled: newValue }),
        },
      );

      if (!response.ok)
        throw new Error(
          `Failed to ${newValue ? "enable" : "disable"} conversations`,
        );

      setIsLocallyEnabled(newValue);
      if (!silent) {
        toast.success(
          `Conversations ${newValue ? "enabled" : "disabled"} successfully`,
        );
      }

      if (onConversationsToggled) {
        onConversationsToggled(newValue);
      }
    } catch (error) {
      console.error(
        `Error ${newValue ? "enabling" : "disabling"} conversations:`,
        error,
      );
      if (!silent) {
        toast.error(
          `Failed to ${newValue ? "enable" : "disable"} conversations`,
        );
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem(
      `dataroom-${dataroomId}-conversations-banner-dismissed`,
      "true",
    );
  };

  if (isDismissed) {
    return null;
  }

  // For plans with conversations included, show simplified banner
  if (isPlanWithConversations) {
    return (
      <Card className="mb-6 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
        <CardHeader className="py-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">
              Q&A Conversations
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={handleDismiss}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Dismiss</span>
            </Button>
          </div>
          <CardDescription>
            Conversations will appear as soon as you enable them on a share link
            to the data room. Go to{" "}
            <Link
              href={`/datarooms/${dataroomId}/permissions`}
              className="underline hover:text-foreground"
            >
              Permissions
            </Link>{" "}
            to set up conversations for specific links.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Show collapsed version
  if (isCollapsed) {
    return (
      <Card className="mb-6 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
        <CardHeader className="py-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">
              {isLocallyEnabled
                ? "Conversations are enabled - click to view setup steps"
                : "Conversations are not enabled for this dataroom - click to expand"}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setIsCollapsed(false)}
              >
                <ChevronDown className="h-4 w-4" />
                <span className="sr-only">Expand</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={handleDismiss}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Dismiss</span>
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mb-6 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
      <CardHeader className="py-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-medium">
            {isLocallyEnabled
              ? "Conversations are enabled for this dataroom"
              : "Conversations are not enabled for this dataroom"}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setIsCollapsed(true)}
            >
              <ChevronUp className="h-4 w-4" />
              <span className="sr-only">Collapse</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={handleDismiss}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Dismiss</span>
            </Button>
          </div>
        </div>
        <CardDescription>
          {isLocallyEnabled
            ? "You've enabled conversations. Here are the next steps:"
            : "Follow these steps to set up Q&A conversations for your dataroom:"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Step 1: Toggle Dataroom Conversations */}
        <div className="rounded-lg border bg-background p-4">
          <div className="mb-3 flex items-center">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              1
            </div>
            <h4 className="ml-2 font-medium">
              {isLocallyEnabled
                ? "Q&A Conversations are enabled for this dataroom"
                : "Enable Q&A Conversations for this dataroom"}
            </h4>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {isLocallyEnabled
                ? "Toggle to disable conversations for all viewers"
                : "Allow conversations for all viewers with access to this dataroom"}
            </p>
            <Switch
              checked={isLocallyEnabled}
              onCheckedChange={handleToggleConversations}
              disabled={isProcessing}
            />
          </div>
        </div>

        {/* Step 2: Enable for a specific link */}
        <div className="rounded-lg border bg-background p-4">
          <div className="mb-3 flex items-center">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              2
            </div>
            <h4 className="ml-2 font-medium">Enable for a specific link</h4>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Enable Q&A conversations for specific links in your dataroom.
              Note: Email authentication is required for conversations.
            </p>
            <Button variant="outline" size="sm">
              <Link href={`/datarooms/${dataroomId}/permissions`}>
                Go to permissions
              </Link>
            </Button>
          </div>
        </div>

        {/* Step 3: Share the link */}
        <div className="rounded-lg border bg-background p-4">
          <div className="mb-3 flex items-center">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              3
            </div>
            <h4 className="ml-2 font-medium">Share with viewers</h4>
          </div>
          <p className="text-sm text-muted-foreground">
            Share your dataroom link with viewers so they can start
            conversations about your documents.
          </p>
        </div>
      </CardContent>
      <CardFooter className="rounded-b-lg border-t bg-gray-200 px-6 py-4 dark:bg-gray-700">
        <p className="text-sm text-muted-foreground">
          Enabling conversations allows viewers to ask questions about specific
          documents or the dataroom in general.
        </p>
      </CardFooter>
    </Card>
  );
}
