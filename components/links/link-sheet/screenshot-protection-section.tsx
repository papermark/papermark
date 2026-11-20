import { useEffect, useState } from "react";

import { DEFAULT_LINK_TYPE } from ".";
import LinkItem from "./link-item";
import { LinkUpgradeOptions } from "./link-options";

export default function ScreenshotProtectionSection({
  data,
  setData,
  isAllowed,
  handleUpgradeStateChange,
}: {
  data: DEFAULT_LINK_TYPE;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_LINK_TYPE>>;
  isAllowed: boolean;
  handleUpgradeStateChange: ({
    state,
    trigger,
    plan,
    highlightItem,
  }: LinkUpgradeOptions) => void;
}) {
  const { enableScreenshotProtection } = data;
  const [enabled, setEnabled] = useState<boolean>(true);

  useEffect(() => {
    setEnabled(enableScreenshotProtection);
  }, [enableScreenshotProtection]);

  const handleEnableScreenshotProtection = () => {
    const updatedEnableScreenshotProtection = !enabled;
    setData({
      ...data,
      enableScreenshotProtection: updatedEnableScreenshotProtection,
    });
    setEnabled(updatedEnableScreenshotProtection);
  };

  return (
    <div className="pb-5">
      <LinkItem
        title="Screenshot protection"
        tooltipContent="Prevent users from taking screenshots of your content. Limited on mobile devices."
        link="https://www.papermark.com/screenshot-protection"
        enabled={enabled}
        action={handleEnableScreenshotProtection}
        isAllowed={isAllowed}
        requiredPlan="business"
        upgradeAction={() =>
          handleUpgradeStateChange({
            state: true,
            trigger: "link_sheet_screenshot_protection_section",
            plan: "Business",
            highlightItem: ["screenshot"],
          })
        }
      />
    </div>
  );
}
