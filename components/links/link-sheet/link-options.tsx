import { useState } from "react";

import { PlanEnum } from "@/ee/stripe/constants";
import { LinkAudienceType, LinkType } from "@prisma/client";
import { LinkPreset } from "@prisma/client";
import { ChevronDown } from "lucide-react";

import { usePlan } from "@/lib/swr/use-billing";
import useLimits from "@/lib/swr/use-limits";
import { cn } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { DEFAULT_LINK_TYPE } from "@/components/links/link-sheet";
import AllowDownloadSection from "@/components/links/link-sheet/allow-download-section";
import AllowListSection from "@/components/links/link-sheet/allow-list-section";
import AllowNotificationSection from "@/components/links/link-sheet/allow-notification-section";
import DenyListSection from "@/components/links/link-sheet/deny-list-section";
import EmailAuthenticationSection from "@/components/links/link-sheet/email-authentication-section";
import EmailProtectionSection from "@/components/links/link-sheet/email-protection-section";
import ExpirationSection from "@/components/links/link-sheet/expiration-section";
import FeedbackSection from "@/components/links/link-sheet/feedback-section";
import OGSection from "@/components/links/link-sheet/og-section";
import PasswordSection from "@/components/links/link-sheet/password-section";
import { ProBannerSection } from "@/components/links/link-sheet/pro-banner-section";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import AgreementSection from "./agreement-section";
import AIAgentsSection from "./ai-agents-section";
import ConversationSection from "./conversation-section";
import CustomFieldsSection from "./custom-fields-section";
import IndexFileSection from "./index-file-section";
import QuestionSection from "./question-section";
import ScreenshotProtectionSection from "./screenshot-protection-section";
import UploadSection from "./upload-section";
import WatermarkSection from "./watermark-section";
import { WelcomeMessageSection } from "./welcome-message-section";

export type LinkUpgradeOptions = {
  state: boolean;
  trigger: string;
  plan?: "Pro" | "Business" | "Data Rooms" | "Data Rooms Plus";
  highlightItem?: string[];
};

// Collapsible Section Component
const CollapsibleSection = ({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="mb-5 flex w-full items-center justify-between rounded-t-md border-b border-border bg-muted/50 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/70">
        <span>{title}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 transition-transform duration-200",
            isOpen ? "rotate-180" : "",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="pt-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export const LinkOptions = ({
  data,
  setData,
  targetId,
  linkType,
  editLink,
  currentPreset = null,
}: {
  data: DEFAULT_LINK_TYPE;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_LINK_TYPE>>;
  targetId?: string;
  linkType: Omit<LinkType, "WORKFLOW_LINK">;
  editLink?: boolean;
  currentPreset?: LinkPreset | null;
}) => {
  const {
    isStarter,
    isPro,
    isBusiness,
    isDatarooms,
    isDataroomsPlus,
    isTrial,
  } = usePlan();
  const { limits } = useLimits();
  const allowAdvancedLinkControls = limits
    ? limits?.advancedLinkControlsOnPro
    : false;
  const allowWatermarkOnBusiness = limits?.watermarkOnBusiness ?? false;
  const allowAgreementOnBusiness = limits?.agreementOnBusiness ?? false;

  const [openUpgradeModal, setOpenUpgradeModal] = useState<boolean>(false);
  const [trigger, setTrigger] = useState<string>("");
  const [upgradePlan, setUpgradePlan] = useState<PlanEnum>(PlanEnum.Business);
  const [highlightItem, setHighlightItem] = useState<string[]>([]);

  const handleUpgradeStateChange = ({
    state,
    trigger,
    plan,
    highlightItem,
  }: LinkUpgradeOptions) => {
    setOpenUpgradeModal(state);
    setTrigger(trigger);
    if (plan) {
      setUpgradePlan(plan as PlanEnum);
    }
    setHighlightItem(highlightItem || []);
  };

  return (
    <div>
      {/* Basic Options - Always visible */}
      <AllowNotificationSection {...{ data, setData }} />
      <EmailProtectionSection {...{ data, setData }} />
      <EmailAuthenticationSection
        {...{ data, setData }}
        isAllowed={
          isTrial ||
          (isPro && allowAdvancedLinkControls) ||
          isBusiness ||
          isDatarooms ||
          isDataroomsPlus
        }
        handleUpgradeStateChange={handleUpgradeStateChange}
      />
      <AllowDownloadSection {...{ data, setData }} />

      {data.audienceType === LinkAudienceType.GENERAL ? (
        <>
          <AllowListSection
            key={`allow-list-${data.id ?? "new"}`}
            {...{ data, setData }}
            isAllowed={
              isTrial ||
              (isPro && allowAdvancedLinkControls) ||
              isBusiness ||
              isDatarooms ||
              isDataroomsPlus
            }
            handleUpgradeStateChange={handleUpgradeStateChange}
            presets={currentPreset}
          />
          <DenyListSection
            key={`deny-list-${data.id ?? "new"}`}
            {...{ data, setData }}
            isAllowed={
              isTrial ||
              (isPro && allowAdvancedLinkControls) ||
              isBusiness ||
              isDatarooms ||
              isDataroomsPlus
            }
            handleUpgradeStateChange={handleUpgradeStateChange}
            presets={currentPreset}
          />
        </>
      ) : null}

      {/* Security Section */}
      <CollapsibleSection title="Security Controls" defaultOpen={true}>
        <div>
          <PasswordSection {...{ data, setData }} />
          <ExpirationSection {...{ data, setData }} presets={currentPreset} />
          <ScreenshotProtectionSection
            {...{ data, setData }}
            isAllowed={
              isTrial ||
              (isPro && allowAdvancedLinkControls) ||
              isBusiness ||
              isDatarooms ||
              isDataroomsPlus
            }
            handleUpgradeStateChange={handleUpgradeStateChange}
          />
          <WatermarkSection
            {...{ data, setData }}
            isAllowed={
              isTrial ||
              isDatarooms ||
              isDataroomsPlus ||
              allowWatermarkOnBusiness
            }
            handleUpgradeStateChange={handleUpgradeStateChange}
            presets={currentPreset}
          />
          <AgreementSection
            {...{ data, setData }}
            isAllowed={
              isTrial ||
              isDatarooms ||
              isDataroomsPlus ||
              allowAgreementOnBusiness
            }
            handleUpgradeStateChange={handleUpgradeStateChange}
          />
          <CustomFieldsSection
            {...{ data, setData }}
            isAllowed={
              isTrial ||
              isBusiness ||
              isDatarooms ||
              isDataroomsPlus ||
              (limits?.linkCustomFields ?? 0) > 0
            }
            handleUpgradeStateChange={handleUpgradeStateChange}
            presets={currentPreset}
          />
        </div>
      </CollapsibleSection>

      {/* Custom Branding Section */}
      <CollapsibleSection title="Custom Branding" defaultOpen={true}>
        <div>
          <WelcomeMessageSection {...{ data, setData }} />
          <OGSection
            {...{ data, setData }}
            isAllowed={
              isTrial ||
              (isPro && allowAdvancedLinkControls) ||
              isBusiness ||
              isDatarooms ||
              isDataroomsPlus
            }
            handleUpgradeStateChange={handleUpgradeStateChange}
            editLink={editLink ?? false}
            presets={currentPreset}
          />
          <ProBannerSection
            {...{ data, setData }}
            isAllowed={
              isTrial ||
              isPro ||
              isBusiness ||
              isDatarooms ||
              isDataroomsPlus ||
              isStarter
            }
            handleUpgradeStateChange={handleUpgradeStateChange}
          />
        </div>
      </CollapsibleSection>

      {/* Advanced Section */}
      <CollapsibleSection title="Advanced Controls" defaultOpen={true}>
        <div>
          {/* AI Agents - Available for both document and dataroom links */}
          <AIAgentsSection
            {...{ data, setData }}
            isAllowed={isTrial || isBusiness || isDatarooms || isDataroomsPlus}
            handleUpgradeStateChange={handleUpgradeStateChange}
          />

          {/* Dataroom-specific options */}
          {linkType === LinkType.DATAROOM_LINK ? (
            <>
              {targetId ? (
                <UploadSection
                  {...{ data, setData }}
                  isAllowed={
                    isTrial ||
                    isDataroomsPlus ||
                    (isDatarooms && limits?.dataroomUpload === true)
                  }
                  handleUpgradeStateChange={handleUpgradeStateChange}
                  targetId={targetId}
                />
              ) : null}

              <IndexFileSection
                {...{ data, setData }}
                isAllowed={isTrial || isDataroomsPlus}
                handleUpgradeStateChange={handleUpgradeStateChange}
              />

              <ConversationSection
                {...{ data, setData }}
                isAllowed={
                  isTrial ||
                  isDataroomsPlus ||
                  ((isBusiness || isDatarooms) &&
                    !!limits?.conversationsInDataroom)
                }
                handleUpgradeStateChange={handleUpgradeStateChange}
              />
            </>
          ) : null}
        </div>
      </CollapsibleSection>

      <UpgradePlanModal
        clickedPlan={upgradePlan}
        open={openUpgradeModal}
        setOpen={setOpenUpgradeModal}
        trigger={trigger}
        highlightItem={highlightItem}
      />
    </div>
  );
};
