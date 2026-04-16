import { useEffect, useState } from "react";

import { DEFAULT_LINK_TYPE } from "@/components/links/link-sheet";
import LinkItem from "@/components/links/link-sheet/link-item";
import { LinkUpgradeOptions } from "@/components/links/link-sheet/link-options";

export default function ConversationSection({
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
  const { enableConversation } = data;
  const [enabled, setEnabled] = useState<boolean>(true);

  useEffect(() => {
    setEnabled(enableConversation);
  }, [enableConversation]);

  const handleEnableConversation = () => {
    const updatedEnableConversation = !enabled;
    if (updatedEnableConversation) {
      // Only set email settings to true when enabling conversations
      setData({
        ...data,
        enableConversation: true,
        emailAuthenticated: true,
        emailProtected: true,
      });
    } else {
      // When disabling conversations, don't modify email settings
      setData({
        ...data,
        enableConversation: false,
      });
    }
    setEnabled(updatedEnableConversation);
  };

  return (
    <div className="pb-5">
      <LinkItem
        title="Enable Q&A Conversations"
        tooltipContent="Private conversations between you and your viewers related to this dataroom."
        enabled={enabled}
        action={handleEnableConversation}
        isAllowed={isAllowed}
        requiredPlan="data rooms plus"
        upgradeAction={() =>
          handleUpgradeStateChange({
            state: true,
            trigger: "link_sheet_conversation_section",
            plan: "Data Rooms Plus",
            highlightItem: ["qa"],
          })
        }
      />
    </div>
  );
}
