import { CircleHelpIcon } from "lucide-react";

import PlanBadge from "@/components/billing/plan-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BadgeTooltip } from "@/components/ui/tooltip";

import { DEFAULT_LINK_TYPE } from ".";
import { LinkUpgradeOptions } from "./link-options";

type EmailAccessLevel = "none" | "email" | "verified";

const SEGMENTS: {
  value: EmailAccessLevel;
  label: string;
  gated?: boolean;
  tooltip: string;
}[] = [
  {
    value: "none",
    label: "No email",
    tooltip: "Data room visitors can open the link without entering an email.",
  },
  {
    value: "email",
    label: "Email",
    tooltip: "Data room visitors must enter their email before viewing.",
  },
  {
    value: "verified",
    label: "Verified email",
    gated: true,
    tooltip:
      "Data room visitors must enter their email and confirm it with a one-time verification code.",
  },
];

export default function EmailAccessSection({
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
  const level: EmailAccessLevel = data.emailAuthenticated
    ? "verified"
    : data.emailProtected
      ? "email"
      : "none";

  const handleSelect = (next: EmailAccessLevel) => {
    if (next === level) return;

    // Verified email requires a paid plan
    if (next === "verified" && !isAllowed) {
      handleUpgradeStateChange({
        state: true,
        trigger: "link_sheet_email_auth_section",
        plan: "Business",
        highlightItem: ["email-verify"],
      });
      return;
    }

    setData((prev) => {
      if (next === "none") {
        return {
          ...prev,
          emailProtected: false,
          emailAuthenticated: false,
          enableConversation: false,
          enableAgreement: false,
          allowList: [],
          denyList: [],
        };
      }

      if (next === "email") {
        return {
          ...prev,
          emailProtected: true,
          emailAuthenticated: false,
          // Conversations require a verified email
          enableConversation: false,
        };
      }

      // verified
      return {
        ...prev,
        emailProtected: true,
        emailAuthenticated: true,
      };
    });
  };

  return (
    <div className="pb-3">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
        <h2 className="flex flex-1 flex-row items-center gap-2 text-sm font-medium leading-6 text-foreground">
          <span>Identity verification</span>
          <BadgeTooltip
            content="Control whether data room visitors must enter an email, and whether it must be verified with a one-time code."
            key="email_access_tooltip"
            link="https://www.papermark.com/help/article/require-email-to-view-document"
          >
            <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
          </BadgeTooltip>
        </h2>

        <Tabs
          value={level}
          onValueChange={(value) => handleSelect(value as EmailAccessLevel)}
        >
          <TabsList className="px-1">
            {SEGMENTS.map((segment) => {
              const showBadge = segment.gated && !isAllowed;

              return (
                <BadgeTooltip content={segment.tooltip} key={segment.value}>
                  <span className="inline-flex">
                    <TabsTrigger value={segment.value} className="gap-1 px-6">
                      <span>{segment.label}</span>
                      {showBadge ? <PlanBadge plan="business" /> : null}
                    </TabsTrigger>
                  </span>
                </BadgeTooltip>
              );
            })}
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
