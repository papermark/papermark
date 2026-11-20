import { LinkWithViews } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type LinkSetting = {
  key: keyof LinkWithViews;
  label: string;
  isActive: (link: LinkWithViews) => boolean;
};

const LINK_SETTINGS: LinkSetting[] = [
  {
    key: "emailProtected",
    label: "Require email to view",
    isActive: (link) => !!link.emailProtected,
  },
  {
    key: "enableNotification",
    label: "Receive email notification",
    isActive: (link) => !!link.enableNotification,
  },
  {
    key: "enableConversation",
    label: "Show visitor statistics",
    isActive: (link) => !!link.enableConversation,
  },
  {
    key: "password",
    label: "Password protection",
    isActive: (link) => !!link.password,
  },
  {
    key: "enableScreenshotProtection",
    label: "Screenshot protection",
    isActive: (link) => !!link.enableScreenshotProtection,
  },
  {
    key: "enableConfidentialView",
    label: "Confidential view",
    isActive: (link) => !!link.enableConfidentialView,
  },
  {
    key: "enableWatermark",
    label: "Watermark enabled",
    isActive: (link) => !!link.enableWatermark,
  },
  {
    key: "enableFeedback",
    label: "Collect feedback",
    isActive: (link) => !!link.enableFeedback,
  },
  {
    key: "allowDownload",
    label: "Allow downloads",
    isActive: (link) => !!link.allowDownload,
  },
  {
    key: "enableQuestion",
    label: "Custom question",
    isActive: (link) => !!link.enableQuestion,
  },
  {
    key: "enableAgreement",
    label: "Requires agreement",
    isActive: (link) => !!link.enableAgreement,
  },
  {
    key: "enableUpload",
    label: "Allow uploads",
    isActive: (link) => !!link.enableUpload,
  },
];

// Helper function to count active settings for a link
export function countActiveSettings(link: LinkWithViews): number {
  return LINK_SETTINGS.filter((setting) => setting.isActive(link)).length;
}

interface LinkActiveControlsProps {
  link: LinkWithViews;
  onEditClick?: (e: React.MouseEvent) => void;
}

export default function LinkActiveControls({
  link,
  onEditClick,
}: LinkActiveControlsProps) {
  const activeSettings = LINK_SETTINGS.filter((setting) =>
    setting.isActive(link),
  );

  return (
    <Card className="p-0">
      <CardHeader className="p-2">
        <CardTitle className="text-sm font-medium">
          Active Link Controls
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2 pt-0">
        <ul className="space-y-1 text-sm">
          {activeSettings.length > 0 ? (
            activeSettings.map((setting) => (
              <li
                key={setting.key.toString()}
                className="flex items-center gap-2 text-foreground"
              >
                <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
                {setting.label}
              </li>
            ))
          ) : (
            <li className="text-muted-foreground">No active settings</li>
          )}
        </ul>
        {onEditClick && (
          <div className="mt-4">
            <Button
              className="h-7 w-full focus-visible:ring-0 focus-visible:ring-offset-0"
              variant="outline"
              size="sm"
              onClick={onEditClick}
            >
              Configure link
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
