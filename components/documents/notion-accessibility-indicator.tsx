import { useEffect, useState } from "react";

import { useTeam } from "@/context/team-context";
import { DocumentVersion } from "@prisma/client";
import {
  CircleCheckIcon,
  CircleXIcon,
  Edit,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { ButtonTooltip } from "@/components/ui/tooltip";

interface NotionAccessibilityIndicatorProps {
  documentId: string;
  primaryVersion: DocumentVersion;
  onUrlUpdate?: () => void;
}

interface AccessibilityStatus {
  isAccessible: boolean;
  url: string;
  statusCode?: number;
  lastChecked: string;
  error?: string;
}

export default function NotionAccessibilityIndicator({
  documentId,
  primaryVersion,
  onUrlUpdate,
}: NotionAccessibilityIndicatorProps) {
  const teamInfo = useTeam();
  const [status, setStatus] = useState<AccessibilityStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMainDialogOpen, setIsMainDialogOpen] = useState(false);
  const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const checkAccessibility = async () => {
    if (!teamInfo?.currentTeam?.id) return;

    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/teams/${teamInfo.currentTeam.id}/documents/${documentId}/check-notion-accessibility`,
      );
      const data = await response.json();

      if (response.ok) {
        setStatus(data);
      } else {
        toast.error("Failed to check accessibility");
      }
    } catch (error) {
      console.error("Error checking accessibility:", error);
      toast.error("Failed to check accessibility");
    } finally {
      setIsLoading(false);
    }
  };

  const updateNotionUrl = async () => {
    if (!teamInfo?.currentTeam?.id || !newUrl.trim()) return;

    setIsUpdating(true);
    try {
      const response = await fetch(
        `/api/teams/${teamInfo.currentTeam.id}/documents/${documentId}/update-notion-url`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ notionUrl: newUrl.trim() }),
        },
      );

      const data = await response.json();

      if (response.ok) {
        toast.success("Notion URL updated successfully");
        setIsUrlDialogOpen(false);
        setNewUrl("");
        // Refresh accessibility status
        await checkAccessibility();
        // Trigger parent component update if provided
        if (onUrlUpdate) {
          onUrlUpdate();
        }
      } else {
        toast.error(data.message || "Failed to update URL");
      }
    } catch (error) {
      console.error("Error updating URL:", error);
      toast.error("Failed to update URL");
    } finally {
      setIsUpdating(false);
    }
  };

  const openNotionPage = () => {
    if (status?.url) {
      window.open(status.url, "_blank");
    }
  };

  // Check accessibility on component mount
  useEffect(() => {
    if (primaryVersion.type === "notion") {
      checkAccessibility();
    }
  }, []);

  // Only render for Notion documents
  if (primaryVersion.type !== "notion") {
    return null;
  }

  const getStatusIcon = () => {
    if (isLoading) {
      return <LoadingSpinner className="h-4 w-4" />;
    }

    if (status?.isAccessible) {
      return (
        <CircleCheckIcon className="h-4 w-4 rounded-full bg-green-500 text-white" />
      );
    } else {
      return (
        <CircleXIcon className="h-4 w-4 rounded-full bg-red-500 text-white" />
      );
    }
  };

  const getTooltipText = () => {
    if (isLoading) {
      return "Checking accessibility...";
    }

    if (status?.isAccessible) {
      return "Notion page is publicly accessible";
    } else if (status?.error) {
      return "Unable to check accessibility";
    } else {
      return "Notion page is not publicly accessible";
    }
  };

  return (
    <>
      {/* Compact Icon Trigger */}
      <Dialog open={isMainDialogOpen} onOpenChange={setIsMainDialogOpen}>
        <ButtonTooltip content={getTooltipText()}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="default"
              className="h-8 w-8 p-0 lg:h-9 lg:w-9"
            >
              {getStatusIcon()}
            </Button>
          </DialogTrigger>
        </ButtonTooltip>

        {/* Main Status Dialog */}
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Notion Page Status</DialogTitle>
            <DialogDescription>
              Check and manage your Notion page accessibility.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Status Display */}
            <div className="flex items-center gap-3 rounded-lg border p-3">
              {getStatusIcon()}
              <div className="flex-1">
                <div className="font-medium">
                  {isLoading
                    ? "Checking..."
                    : status?.isAccessible
                      ? "Publicly accessible"
                      : status?.error
                        ? "Unable to check"
                        : "Not publicly accessible"}
                </div>
                {status?.lastChecked && (
                  <div className="text-sm text-gray-500">
                    Last checked:{" "}
                    {new Date(status.lastChecked).toLocaleTimeString()}
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={checkAccessibility}
                disabled={isLoading}
                className="flex-1"
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>

              {status?.url && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openNotionPage}
                  className="flex-1"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open Page
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setNewUrl(status?.url || "");
                  setIsUrlDialogOpen(true);
                }}
                className="flex-1"
              >
                <Edit className="mr-2 h-4 w-4" />
                Edit URL
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* URL Edit Dialog */}
      <Dialog open={isUrlDialogOpen} onOpenChange={setIsUrlDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update Notion URL</DialogTitle>
            <DialogDescription>
              Change the URL of the Notion page for this document.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="notion-url">Notion URL</Label>
              <Input
                id="notion-url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://www.notion.com/your-page-url"
                className="w-full"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsUrlDialogOpen(false)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button
              onClick={updateNotionUrl}
              disabled={isUpdating || !newUrl.trim()}
            >
              {isUpdating ? (
                <>
                  <LoadingSpinner className="mr-2 h-4 w-4" />
                  Updating...
                </>
              ) : (
                "Update URL"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
