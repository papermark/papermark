import {
  EyeIcon,
  FileUpIcon,
  InfoIcon,
  MessageSquareIcon,
  ServerIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  useNotificationPreferences,
} from "@/lib/swr/use-notification-preferences";
import type {
  TeamNotificationScope,
  TeamNotificationType,
} from "@/lib/zod/schemas/notifications";

import AppLayout from "@/components/layouts/app";
import { SettingsHeader } from "@/components/settings/settings-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const SCOPE_LABELS: Record<TeamNotificationScope, string> = {
  ALL: "All activity",
  MINE_ONLY: "My links only",
};

type NotificationConfig = {
  type: TeamNotificationType;
  title: string;
  description: string;
  icon: React.ElementType;
};

type NotificationCategory = {
  label: string;
  items: NotificationConfig[];
};

const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  {
    label: "Documents",
    items: [
      {
        type: "DOCUMENT_VIEW",
        title: "Document viewed",
        description: "When someone views a document link",
        icon: EyeIcon,
      },
    ],
  },
  {
    label: "Data rooms",
    items: [
      {
        type: "DATAROOM_VIEW",
        title: "Data room visited",
        description: "When someone visits a data room link",
        icon: ServerIcon,
      },
      {
        type: "DATAROOM_UPLOAD",
        title: "File uploaded",
        description: "When a viewer uploads files to a data room",
        icon: FileUpIcon,
      },
      {
        type: "CONVERSATION_MESSAGE",
        title: "New question",
        description: "When a new question is posted in a data room",
        icon: MessageSquareIcon,
      },
    ],
  },
  {
    label: "Security",
    items: [
      {
        type: "BLOCKED_ACCESS",
        title: "Blocked access attempt",
        description: "When a viewer is denied access to a link",
        icon: ShieldAlertIcon,
      },
    ],
  },
];

export default function NotificationsSettings() {
  const { preferences, role, isLoading, updatePreferences } =
    useNotificationPreferences();

  const isMember = role === "MEMBER";
  const isAdminOrManager = role === "ADMIN" || role === "MANAGER";

  const handleToggle = async (
    type: TeamNotificationType,
    enabled: boolean,
  ) => {
    try {
      await updatePreferences([
        { type, frequency: enabled ? "IMMEDIATE" : "NEVER" },
      ]);
      toast.success("Notification preference updated");
    } catch {
      toast.error("Failed to update notification preference");
    }
  };

  const handleScopeChange = async (
    type: TeamNotificationType,
    scope: TeamNotificationScope,
  ) => {
    try {
      await updatePreferences([{ type, frequency: "IMMEDIATE", scope }]);
      toast.success("Notification scope updated");
    } catch {
      toast.error("Failed to update notification scope");
    }
  };

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />

        <div className="space-y-2">
          <h3 className="text-lg font-semibold tracking-tight text-foreground">
            Notifications
          </h3>
          <p className="text-sm text-muted-foreground">
            Choose which email notifications you want to receive for this team.
          </p>
        </div>

        {isMember ? (
          <Alert>
            <InfoIcon className="h-4 w-4" />
            <AlertDescription>
              As a team member, you&apos;ll only receive notifications for
              documents and links you own.
            </AlertDescription>
          </Alert>
        ) : null}

        {isLoading ? (
          <div className="space-y-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-4">
                <div className="h-5 w-32 animate-pulse rounded bg-muted" />
                <div className="h-16 w-full animate-pulse rounded-lg bg-muted" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {NOTIFICATION_CATEGORIES.map((category) => (
              <div key={category.label} className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">
                  {category.label}
                </h4>
                <div className="divide-y rounded-lg border">
                  {category.items.map((item) => {
                    const pref = preferences?.[item.type];
                    const enabled =
                      (pref?.frequency ?? "IMMEDIATE") !== "NEVER";
                    const scope = pref?.scope ?? "ALL";

                    return (
                      <NotificationRow
                        key={item.type}
                        item={item}
                        isAdminOrManager={isAdminOrManager}
                        enabled={enabled}
                        scope={scope}
                        onToggle={(val) => handleToggle(item.type, val)}
                        onScopeChange={(s) =>
                          handleScopeChange(item.type, s)
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </AppLayout>
  );
}

function NotificationRow({
  item,
  isAdminOrManager,
  enabled,
  scope,
  onToggle,
  onScopeChange,
}: {
  item: NotificationConfig;
  isAdminOrManager: boolean;
  enabled: boolean;
  scope: TeamNotificationScope;
  onToggle: (enabled: boolean) => void;
  onScopeChange: (scope: TeamNotificationScope) => void;
}) {
  const Icon = item.icon;

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{item.title}</p>
          <p className="text-xs text-muted-foreground">{item.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {isAdminOrManager && enabled ? (
          <Select
            value={scope}
            onValueChange={(value) =>
              onScopeChange(value as TeamNotificationScope)
            }
          >
            <SelectTrigger className="w-[140px] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SCOPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </div>
    </div>
  );
}
