import { CircleHelpIcon } from "lucide-react";

import { useDataroom } from "@/lib/swr/use-dataroom";

import NotificationSettings from "@/components/datarooms/settings/notification-settings";
import AppLayout from "@/components/layouts/app";
import { BadgeTooltip } from "@/components/ui/tooltip";

export default function Notifications() {
  const { dataroom } = useDataroom();

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="space-y-1">
          <h3 className="text-2xl font-semibold tracking-tight text-foreground">
            Notifications
          </h3>
          <p className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
            Configure email notifications for your data room.
            <BadgeTooltip
              linkText="Learn more"
              content="Manage email notification settings."
              key="notifications"
              link="https://www.papermark.com/help/article/email-notifications"
            >
              <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
            </BadgeTooltip>
          </p>
        </div>

        <div className="grid gap-6">
          <NotificationSettings dataroomId={dataroom.id} />
        </div>
      </main>
    </AppLayout>
  );
}
