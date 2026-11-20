import { useRouter } from "next/router";

import { FormEvent, useState } from "react";

import { useTeam } from "@/context/team-context";
import ConfidentialViewSection from "@/ee/features/permissions/components/confidential-view/confidential-view-section";
import { PlanEnum } from "@/ee/stripe/constants";
import { LinkType } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { usePlan } from "@/lib/swr/use-billing";
import useLimits from "@/lib/swr/use-limits";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import AppLayout from "@/components/layouts/app";
import {
  DEFAULT_LINK_PROPS,
  DEFAULT_LINK_TYPE,
} from "@/components/links/link-sheet";
import AgreementSection from "@/components/links/link-sheet/agreement-section";
import AllowDownloadSection from "@/components/links/link-sheet/allow-download-section";
import AllowListSection from "@/components/links/link-sheet/allow-list-section";
import AllowNotificationSection from "@/components/links/link-sheet/allow-notification-section";
import { CustomFieldData } from "@/components/links/link-sheet/custom-fields-panel";
import CustomFieldsSection from "@/components/links/link-sheet/custom-fields-section";
import DenyListSection from "@/components/links/link-sheet/deny-list-section";
import EmailAuthenticationSection from "@/components/links/link-sheet/email-authentication-section";
import EmailProtectionSection from "@/components/links/link-sheet/email-protection-section";
import ExpirationInSection from "@/components/links/link-sheet/expirationIn-section";
import { LinkUpgradeOptions } from "@/components/links/link-sheet/link-options";
import OGSection from "@/components/links/link-sheet/og-section";
import PasswordSection from "@/components/links/link-sheet/password-section";
import { ProBannerSection } from "@/components/links/link-sheet/pro-banner-section";
import ScreenshotProtectionSection from "@/components/links/link-sheet/screenshot-protection-section";
import WatermarkSection from "@/components/links/link-sheet/watermark-section";
import Preview from "@/components/settings/og-preview";
import { SettingsHeader } from "@/components/settings/settings-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export default function NewPreset() {
  const router = useRouter();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<
    DEFAULT_LINK_TYPE & {
      expiresIn?: number | null;
      customFields?: CustomFieldData[];
    }
  >({
    ...DEFAULT_LINK_PROPS(LinkType.DOCUMENT_LINK),
    name: "",
  });

  const { isPro, isBusiness, isDatarooms, isDataroomsPlus, isTrial } =
    usePlan();
  const { limits } = useLimits();
  const allowAdvancedLinkControls = limits
    ? limits?.advancedLinkControlsOnPro
    : false;
  const allowWatermarkOnBusiness = limits?.watermarkOnBusiness ?? false;

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!data.name) {
      toast.error("Please provide a name for the preset");
      return;
    }

    if (data.expiresAt && data.expiresAt < new Date()) {
      toast.error("Expiration time must be in the future");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`/api/teams/${teamId}/presets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: data.name,
          emailProtected: data.emailProtected,
          emailAuthenticated: data.emailAuthenticated,
          allowList: data.allowList,
          denyList: data.denyList,
          enableAllowList: data.allowList ? data.allowList.length > 0 : false,
          enableDenyList: data.denyList ? data.denyList.length > 0 : false,
          password: data.password,
          enablePassword: !!data.password,
          enableCustomMetaTag: data.enableCustomMetatag,
          metaTitle: data.metaTitle,
          metaDescription: data.metaDescription,
          metaImage: data.metaImage,
          metaFavicon: data.metaFavicon,
          enableWatermark: data.enableWatermark,
          watermarkConfig: data.watermarkConfig,
          allowDownload: data.allowDownload,
          expiresAt: data.expiresAt,
          expiresIn: data.expiresIn || null,
          enableScreenshotProtection: data.enableScreenshotProtection,
          enableConfidentialView: data.enableConfidentialView,
          enableAgreement: data.enableAgreement,
          agreementId: data.agreementId,
          enableCustomFields: data.customFields
            ? data.customFields.length > 0
            : false,
          customFields: data.customFields,
          enableNotification: data.enableNotification,
          showBanner: data.showBanner,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create preset");
      }

      toast.success("Preset created successfully");
      router.push("/settings/presets");
    } catch (error) {
      toast.error("Failed to create preset");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />

        <Button
          variant="ghost"
          size="sm"
          className="mb-2 flex items-center gap-2 pl-0 text-muted-foreground"
          onClick={() => router.push("/settings/presets")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to presets
        </Button>

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight">
              Create New Preset
            </h2>
            <div className="space-y-2">
              <Label htmlFor="name">Preset Name</Label>
              <p className="text-sm text-muted-foreground">
                Choose a descriptive name for this preset
              </p>
              <Input
                id="name"
                placeholder="My Link Preset"
                value={data.name || ""}
                onChange={(e) =>
                  setData((prev) => ({ ...prev, name: e.target.value }))
                }
                required
                data-1p-ignore
                autoComplete="off"
                autoFocus
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-6">
              <div className="rounded-lg border p-6">
                <h3 className="mb-4 text-lg font-medium">Link Preview Cards</h3>
                <OGSection
                  data={data}
                  setData={setData}
                  isAllowed={
                    isTrial ||
                    (isPro && allowAdvancedLinkControls) ||
                    isBusiness ||
                    isDatarooms ||
                    isDataroomsPlus
                  }
                  handleUpgradeStateChange={handleUpgradeStateChange}
                  editLink={false}
                  presets={null}
                />
              </div>

              <div className="rounded-lg border p-6">
                <h3 className="mb-4 text-lg font-medium">Basic Settings</h3>
                <EmailProtectionSection data={data} setData={setData} />
                <EmailAuthenticationSection
                  data={data}
                  setData={setData}
                  isAllowed={
                    isTrial ||
                    (isPro && allowAdvancedLinkControls) ||
                    isBusiness ||
                    isDatarooms ||
                    isDataroomsPlus
                  }
                  handleUpgradeStateChange={handleUpgradeStateChange}
                />
                <AllowNotificationSection data={data} setData={setData} />
                <AllowDownloadSection data={data} setData={setData} />
                <ExpirationInSection data={data} setData={setData} />
              </div>

              <div className="rounded-lg border p-6">
                <h3 className="mb-4 text-lg font-medium">Access Control</h3>
                <PasswordSection data={data} setData={setData} />
                <AllowListSection
                  data={data}
                  setData={setData}
                  isAllowed={
                    isTrial ||
                    (isPro && allowAdvancedLinkControls) ||
                    isBusiness ||
                    isDatarooms ||
                    isDataroomsPlus
                  }
                  handleUpgradeStateChange={handleUpgradeStateChange}
                  presets={null}
                />
                <DenyListSection
                  data={data}
                  setData={setData}
                  isAllowed={
                    isTrial ||
                    (isPro && allowAdvancedLinkControls) ||
                    isBusiness ||
                    isDatarooms ||
                    isDataroomsPlus
                  }
                  handleUpgradeStateChange={handleUpgradeStateChange}
                  presets={null}
                />
              </div>

              <div className="rounded-lg border p-6">
                <h3 className="mb-4 text-lg font-medium">
                  Additional Security
                </h3>
                <WatermarkSection
                  data={data}
                  setData={setData}
                  isAllowed={
                    isTrial ||
                    isDatarooms ||
                    isDataroomsPlus ||
                    allowWatermarkOnBusiness
                  }
                  handleUpgradeStateChange={handleUpgradeStateChange}
                  presets={null}
                />
                <ScreenshotProtectionSection
                  data={data}
                  setData={setData}
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
                  data={data}
                  setData={setData}
                  isAllowed={
                    isTrial || isBusiness || isDatarooms || isDataroomsPlus
                  }
                  handleUpgradeStateChange={handleUpgradeStateChange}
                />
                <AgreementSection
                  data={data}
                  setData={setData}
                  isAllowed={isTrial || isDatarooms || isDataroomsPlus}
                  handleUpgradeStateChange={handleUpgradeStateChange}
                />
                <CustomFieldsSection
                  data={data}
                  setData={setData}
                  isAllowed={
                    isTrial ||
                    (isPro && allowAdvancedLinkControls) ||
                    isBusiness ||
                    isDatarooms ||
                    isDataroomsPlus
                  }
                  handleUpgradeStateChange={handleUpgradeStateChange}
                  presets={null}
                />
              </div>

              <div className="rounded-lg border p-6">
                <h3 className="mb-4 text-lg font-medium">Branding</h3>
                <ProBannerSection
                  data={data}
                  setData={setData}
                  isAllowed={
                    isTrial ||
                    (isPro && allowAdvancedLinkControls) ||
                    isBusiness ||
                    isDatarooms ||
                    isDataroomsPlus
                  }
                  handleUpgradeStateChange={handleUpgradeStateChange}
                />
              </div>
            </div>

            <div className="sticky top-0 md:overflow-auto">
              <div className="rounded-lg border">
                {/* <div className="sticky top-0 flex h-14 items-center justify-center border-b bg-white px-5 dark:bg-gray-900">
                  <h2 className="text-lg font-medium">Preview</h2>
                </div> */}
                <div className="p-4">
                  <Preview data={data as any} setData={setData as any} />
                </div>
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/settings/presets")}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Creating..." : "Create Preset"}
            </Button>
          </div>
        </form>
      </main>
      <UpgradePlanModal
        clickedPlan={upgradePlan}
        open={openUpgradeModal}
        setOpen={setOpenUpgradeModal}
        trigger={trigger}
        highlightItem={highlightItem}
      />
    </AppLayout>
  );
}
