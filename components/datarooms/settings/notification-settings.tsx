import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { BadgeCheckIcon, CrownIcon } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";

import { usePlan } from "@/lib/swr/use-billing";
import { fetcher } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface NotificationSettingsProps {
  dataroomId: string;
}

export default function NotificationSettings({
  dataroomId,
}: NotificationSettingsProps) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { isDataroomsPlus, isTrial } = usePlan();

  const { data: dataroomData, mutate: mutateDataroom } = useSWR<{
    id: string;
    name: string;
    pId: string;
    enableChangeNotifications: boolean;
    enableVisitorUploadChangeNotifications: boolean;
  }>(
    dataroomId ? `/api/teams/${teamId}/datarooms/${dataroomId}` : null,
    fetcher,
  );

  const { data: features } = useSWR<{ roomChangeNotifications: boolean }>(
    teamInfo?.currentTeam?.id
      ? `/api/feature-flags?teamId=${teamInfo.currentTeam.id}`
      : null,
    fetcher,
  );

  const handleNotificationToggle = async (
    field: "enableChangeNotifications" | "enableVisitorUploadChangeNotifications",
    checked: boolean,
  ) => {
    if (!dataroomId || !teamId) return;

    if (!isDataroomsPlus && !isTrial && !features?.roomChangeNotifications) {
      toast.error("This feature is not available in your plan");
      return;
    }

    toast.promise(
      fetch(`/api/teams/${teamId}/datarooms/${dataroomId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          [field]: checked,
        }),
      }).then(async (res) => {
        if (!res.ok) {
          throw new Error("Failed to update notification settings");
        }
        await mutateDataroom();
      }),
      {
        loading: "Updating notification settings...",
        success: "Notification settings updated successfully",
        error: "Failed to update notification settings",
      },
    );
  };

  return (
    <Card className="bg-transparent">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Notifications{" "}
          {!isDataroomsPlus && !isTrial && !features?.roomChangeNotifications ? (
            <UpgradePlanModal
              clickedPlan={PlanEnum.DataRoomsPlus}
              trigger="dataroom_notification_settings"
              highlightItem={["invite"]}
            >
              <Button variant="outline" size="sm" className="gap-1.5">
                <CrownIcon className="h-4 w-4" />
                Upgrade to Enable
              </Button>
            </UpgradePlanModal>
          ) : null}
        </CardTitle>
        <CardDescription>
          Configure change notifications for this dataroom.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <Label htmlFor="notification-toggle">
            Notify visitors when new documents are added
          </Label>
          <Switch
            id="notification-toggle"
            checked={dataroomData?.enableChangeNotifications ?? false}
            onCheckedChange={(checked) =>
              handleNotificationToggle("enableChangeNotifications", checked)
            }
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="visitor-upload-notification-toggle">
            Notify visitors when another visitor uploads a document
          </Label>
          <Switch
            id="visitor-upload-notification-toggle"
            checked={
              dataroomData?.enableVisitorUploadChangeNotifications ?? false
            }
            onCheckedChange={(checked) =>
              handleNotificationToggle(
                "enableVisitorUploadChangeNotifications",
                checked,
              )
            }
          />
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between rounded-b-lg border-t bg-muted px-6 py-6">
        <p className="text-sm text-muted-foreground transition-colors">
          When enabled,{" "}
          <span className="inline-flex items-center gap-x-1 font-bold">
            verified visitors <BadgeCheckIcon className="h-4 w-4 font-normal" />
          </span>{" "}
          will automatically receive an email notification when new documents
          are added to this dataroom.
        </p>
      </CardFooter>
    </Card>
  );
}
