import { useEffect, useState } from "react";

import { LinkType } from "@prisma/client";

import { DEFAULT_LINK_TYPE } from "@/components/links/link-sheet";
import LinkItem from "@/components/links/link-sheet/link-item";
import { LinkUpgradeOptions } from "@/components/links/link-sheet/link-options";

export default function ConversationSection({
  data,
  setData,
  isAllowed,
  handleUpgradeStateChange,
  linkType,
}: {
  data: DEFAULT_LINK_TYPE;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_LINK_TYPE>>;
  isAllowed: boolean;
  handleUpgradeStateChange: ({
    state,
    trigger,
    plan,
  }: LinkUpgradeOptions) => void;
  linkType?: Omit<LinkType, "WORKFLOW_LINK">;
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

  const isDocumentLink = linkType === LinkType.DOCUMENT_LINK;
  const tooltipContent = isDocumentLink
    ? "Private conversations between you and your viewers related to this document."
    : "Private conversations between you and your viewers related to this dataroom.";

  return (
    <div className="pb-5">
      <LinkItem
        title="Enable Q&A Conversations"
        tooltipContent={tooltipContent}
        enabled={enabled}
        action={handleEnableConversation}
        isAllowed={isAllowed}
        requiredPlan={isDocumentLink ? "Pro" : "data rooms plus"}
        upgradeAction={() =>
          handleUpgradeStateChange({
            state: true,
            trigger: "link_sheet_conversation_section",
            plan: isDocumentLink ? "Pro" : "Data Rooms Plus",
          })
        }
      />
    </div>
  );
}
