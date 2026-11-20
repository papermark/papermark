import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { DEFAULT_LINK_TYPE } from ".";
import LinkItem from "./link-item";

export default function AllowNotificationSection({
  data,
  setData,
  title = "Receive email notification",
  className = "pb-5",
}: {
  data: DEFAULT_LINK_TYPE;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_LINK_TYPE>>;
  title?: string;
  className?: string;
}) {
  const { enableNotification } = data;
  const [enabled, setEnabled] = useState<boolean>(true);

  useEffect(() => {
    setEnabled(enableNotification);
  }, [enableNotification]);

  const handleEnableNotification = () => {
    const updatedEnableNotification = !enabled;
    setData({ ...data, enableNotification: updatedEnableNotification });
    setEnabled(updatedEnableNotification);
  };

  return (
    <div className={cn(className)}>
      <LinkItem
        title={title}
        link="https://www.papermark.com/help/article/link-settings"
        enabled={enabled}
        action={handleEnableNotification}
        tooltipContent="Get notified via email when someone views your content."
      />
    </div>
  );
}
