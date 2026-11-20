import { useEffect, useState } from "react";

import { useFeatureFlags } from "@/lib/hooks/use-feature-flags";

import { DEFAULT_LINK_TYPE } from "@/components/links/link-sheet";
import LinkItem from "@/components/links/link-sheet/link-item";

import { LinkUpgradeOptions } from "./link-options";

export default function AIAgentsSection({
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
  }: LinkUpgradeOptions) => void;
}) {
  const { isFeatureEnabled, isLoading: featuresLoading } = useFeatureFlags();
  const isAIFeatureEnabled = isFeatureEnabled("ai");

  const { enableAIAgents } = data;
  const [enabled, setEnabled] = useState<boolean>(false);

  useEffect(() => {
    setEnabled(enableAIAgents);
  }, [enableAIAgents]);

  const handleToggle = async () => {
    const updatedState = !enabled;

    setData({
      ...data,
      enableAIAgents: updatedState,
    });
    setEnabled(updatedState);
  };

  // Don't render if feature flags are still loading or AI feature is not enabled
  if (featuresLoading || !isAIFeatureEnabled) {
    return null;
  }

  return (
    <div className="pb-5">
      <LinkItem
        title="AI agents"
        enabled={enabled}
        action={handleToggle}
        isAllowed={isAllowed}
        requiredPlan="Business"
        upgradeAction={() =>
          handleUpgradeStateChange({
            state: true,
            trigger: "link_sheet_ai_agents",
            plan: "Business",
          })
        }
        tooltipContent="Allow visitors to chat with AI about this document or dataroom. Requires AI to be enabled at the team and document/dataroom level."
      />
    </div>
  );
}
