import { useState } from "react";

import ConfidentialViewSection from "@/ee/features/permissions/components/confidential-view/confidential-view-section";
import { PlanEnum } from "@/ee/stripe/constants";
import { LinkAudienceType, LinkType } from "@prisma/client";
import { LinkPreset } from "@prisma/client";
import { ChevronDown } from "lucide-react";

import { useFeatureFlags } from "@/lib/hooks/use-feature-flags";
import { usePlan } from "@/lib/swr/use-billing";
import useLimits from "@/lib/swr/use-limits";
import { cn } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { DEFAULT_LINK_TYPE } from "@/components/links/link-sheet";
import AllowBlockListSection from "@/components/links/link-sheet/allow-block-list-section";
import AllowDownloadSection from "@/components/links/link-sheet/allow-download-section";
import AllowListSection from "@/components/links/link-sheet/allow-list-section";
import AllowNotificationSection from "@/components/links/link-sheet/allow-notification-section";
import DenyListSection from "@/components/links/link-sheet/deny-list-section";
import EmailAccessSection from "@/components/links/link-sheet/email-access-section";
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
import { Separator } from "@/components/ui/separator";

import AgreementSection from "./agreement-section";
import AIAgentsSection from "./ai-agents-section";
import { BrandSection } from "./brand-section";
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
      <CollapsibleTrigger className="group relative mb-5 mt-4 flex w-full items-center">
        <Separator className="absolute top-1/2 -translate-y-1/2" />
        <div className="relative mx-auto flex items-center gap-1.5 bg-background px-3 dark:bg-gray-900">
          <span className="text-sm text-muted-foreground transition-colors group-hover:text-foreground">
            {title}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:text-foreground",
              isOpen ? "rotate-180" : "",
            )}
          />
        </div>
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
  setValidationError,
  defaultExpandSections = true,
  dataroomStyle = false,
}: {
  data: DEFAULT_LINK_TYPE;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_LINK_TYPE>>;
  targetId?: string;
  linkType: Omit<LinkType, "WORKFLOW_LINK">;
  editLink?: boolean;
  currentPreset?: LinkPreset | null;
  setValidationError?: (key: string, errors: string[]) => void;
  /**
   * Controls whether the "Custom branding" and "Advanced controls" sections
   * start expanded. Defaults to `true` to preserve the create-link sheet's
   * behaviour; the full-page builder passes `false` to start them collapsed.
   */
  defaultExpandSections?: boolean;
  /**
   * Opt into the data room-style layout for document links: a single
   * "Identity verification" segmented control, a unified allow & block list,
   * "Allow downloading" relocated under the expiration date, a flattened
   * (non-collapsible) security controls group, and the view notification moved
   * to the bottom of the sheet (rendered by the parent). Data room links always
   * use this layout regardless of the flag.
   */
  dataroomStyle?: boolean;
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
  const { isFeatureEnabled } = useFeatureFlags();
  const isAIFeatureEnabled = isFeatureEnabled("ai");
  // The "Advanced controls" section only renders content for data room links
  // (upload, file indexing, conversations) or when the AI agents feature is
  // enabled for the team. For document links without AI, it would be empty.
  const showAdvancedControls =
    linkType === LinkType.DATAROOM_LINK || isAIFeatureEnabled;
  // Data room links always use the consolidated layout; document links opt in
  // via the `dataroomStyle` prop (e.g. the create/edit link modal).
  const useDataroomStyleLayout =
    linkType === LinkType.DATAROOM_LINK || dataroomStyle;
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

  const securityControls = (
    <div>
      <PasswordSection {...{ data, setData }} />
      <ExpirationSection {...{ data, setData }} presets={currentPreset} />
      {/* In the consolidated layout, "Allow downloading" sits directly under
          the expiration date. */}
      {useDataroomStyleLayout && (
        <AllowDownloadSection {...{ data, setData }} />
      )}
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
      <ConfidentialViewSection
        {...{ data, setData }}
        isAllowed={isTrial || isBusiness || isDatarooms || isDataroomsPlus}
        handleUpgradeStateChange={handleUpgradeStateChange}
      />
      <WatermarkSection
        {...{ data, setData }}
        isAllowed={
          isTrial || isDatarooms || isDataroomsPlus || allowWatermarkOnBusiness
        }
        handleUpgradeStateChange={handleUpgradeStateChange}
        presets={currentPreset}
      />
      <AgreementSection
        {...{ data, setData }}
        isAllowed={
          isTrial || isDatarooms || isDataroomsPlus || allowAgreementOnBusiness
        }
        handleUpgradeStateChange={handleUpgradeStateChange}
      />
    </div>
  );

  return (
    <div>
      {/* Basic Options - Always visible */}
      {/* In the consolidated layout the owner-facing view notification is moved
          to the bottom of the sheet (rendered by the parent) so the list leads
          with viewer-facing access controls. */}
      {!useDataroomStyleLayout && (
        <AllowNotificationSection {...{ data, setData }} />
      )}
      {useDataroomStyleLayout ? (
        // Combine "require email" + "require verification" into a single
        // segmented control to make the relationship between the two levels
        // clear and save vertical space.
        <EmailAccessSection
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
      ) : (
        <>
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
        </>
      )}
      {/* In the consolidated layout "Allow downloading" is relocated under the
          expiration date within the (flattened) security controls below. */}
      {!useDataroomStyleLayout && (
        <AllowDownloadSection {...{ data, setData }} />
      )}

      {data.audienceType === LinkAudienceType.GENERAL ? (
        useDataroomStyleLayout ? (
          // Combine the allow + block lists under a single toggle (both lists
          // remain configurable).
          <AllowBlockListSection
            key={`allow-block-${data.id ?? "new"}`}
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
            setValidationError={setValidationError}
          />
        ) : (
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
              setValidationError={setValidationError}
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
              setValidationError={setValidationError}
            />
          </>
        )
      ) : null}

      {/* Security Section. In the consolidated layout the security controls are
          merged into the main list (no collapsible subgroup/separator); the
          standalone layout keeps the collapsible group. */}
      {useDataroomStyleLayout ? (
        securityControls
      ) : (
        <CollapsibleSection title="Security controls" defaultOpen={true}>
          {securityControls}
        </CollapsibleSection>
      )}

      {/* Custom Branding Section */}
      <CollapsibleSection
        title="Custom branding"
        defaultOpen={defaultExpandSections}
      >
        <div>
          <BrandSection
            data={data}
            setData={setData}
            linkType={linkType}
            dataroomId={linkType === "DATAROOM_LINK" ? targetId : undefined}
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
          <WelcomeMessageSection
            data={data}
            setData={setData}
            isAllowed={isTrial || isBusiness || isDatarooms || isDataroomsPlus}
            handleUpgradeStateChange={handleUpgradeStateChange}
          />
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
      {showAdvancedControls && (
        <CollapsibleSection
          title="Advanced controls"
          defaultOpen={defaultExpandSections}
        >
          <div>
            {/* AI Agents - Available for both document and dataroom links */}
            <AIAgentsSection
              {...{ data, setData }}
              isAllowed={
                isTrial || isBusiness || isDatarooms || isDataroomsPlus
              }
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
      )}

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
