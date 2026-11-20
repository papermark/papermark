import { useRouter } from "next/router";

import { FormEvent, useEffect, useState } from "react";

import { useTeam } from "@/context/team-context";
import ConfidentialViewSection from "@/ee/features/permissions/components/confidential-view/confidential-view-section";
import { PlanEnum } from "@/ee/stripe/constants";
import { LinkPreset } from "@prisma/client";
import { AlertCircle, ArrowLeft, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import z from "zod";

import { usePlan } from "@/lib/swr/use-billing";
import useLimits from "@/lib/swr/use-limits";
import { WatermarkConfig } from "@/lib/types";
import { fetcher } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import AppLayout from "@/components/layouts/app";
import { DEFAULT_LINK_TYPE } from "@/components/links/link-sheet";
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
import {
  Alert,
  AlertClose,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export type PRESET_DATA = Partial<DEFAULT_LINK_TYPE> & {
  name: string;
  enableAllowList?: boolean;
  enableDenyList?: boolean;
  expiresAt?: Date | null;
  expiresIn?: number | null;
  pId?: string | null;
  enableCustomFields?: boolean;
  customFields?: CustomFieldData[];
};

export default function EditPreset() {
  const router = useRouter();
  const { id } = router.query;
  const { currentTeamId: teamId } = useTeam();

  const {
    data: preset,
    error,
    isLoading: isLoadingPreset,
  } = useSWR<LinkPreset>(
    id && teamId ? `/api/teams/${teamId}/presets/${id}` : null,
    fetcher,
  );

  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [data, setData] = useState<PRESET_DATA | null>(null);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);

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

  useEffect(() => {
    if (preset) {
      const watermarkConfig = preset.watermarkConfig
        ? (JSON.parse(preset.watermarkConfig as string) as WatermarkConfig)
        : null;

      const customFields = preset.customFields
        ? (preset.customFields as CustomFieldData[])
        : [];

      setData({
        id: null,
        name: preset.name,
        expiresAt: preset.expiresAt,
        expiresIn: preset.expiresIn,
        password: preset.password,
        emailProtected: preset.emailProtected ?? true,
        emailAuthenticated: preset.emailAuthenticated ?? false,
        allowDownload: preset.allowDownload ?? false,
        allowList: preset.allowList || [],
        denyList: preset.denyList || [],
        enableCustomMetatag: preset.enableCustomMetaTag ?? false,
        metaTitle: preset.metaTitle,
        metaDescription: preset.metaDescription,
        metaImage: preset.metaImage,
        metaFavicon: preset.metaFavicon,
        enableWatermark: preset.enableWatermark ?? false,
        watermarkConfig: watermarkConfig,
        pId: preset.pId,
        enableScreenshotProtection: preset.enableScreenshotProtection ?? false,
        enableConfidentialView: preset.enableConfidentialView ?? false,
        enableAgreement: preset.enableAgreement ?? false,
        agreementId: preset.agreementId,
        enableCustomFields: customFields.length > 0,
        customFields: customFields,
        enableNotification: preset.enableNotification ?? false,
        showBanner: preset.showBanner ?? false,
      });
    }
  }, [preset]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!data) return;

    setIsLoading(true);

    if (data.expiresAt && data.expiresAt < new Date()) {
      toast.error("Expiration time must be in the future");
      setIsLoading(false);
      return;
    }

    try {
      const presetId = z.string().cuid().parse(id);
      const response = await fetch(`/api/teams/${teamId}/presets/${presetId}`, {
        method: "PUT",
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
          expiresIn: data.expiresIn,
          pId: data.pId,
          enableScreenshotProtection: data.enableScreenshotProtection,
          enableConfidentialView: data.enableConfidentialView,
          enableAgreement: data.enableAgreement,
          agreementId: data.agreementId,
          enableCustomFields: data.enableCustomFields,
          customFields: data.customFields,
          enableNotification: data.enableNotification,
          showBanner: data.showBanner,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update preset");
      }

      toast.success("Preset updated successfully");
    } catch (error) {
      toast.error("Failed to update preset");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);

    try {
      const presetId = z.string().cuid().parse(id);
      const response = await fetch(`/api/teams/${teamId}/presets/${presetId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete preset");
      }

      toast.success("Preset deleted successfully");
      router.push("/settings/presets");
    } catch (error) {
      toast.error("Failed to delete preset");
      console.error(error);
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoadingPreset) {
    return (
      <AppLayout>
        <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
          <SettingsHeader />
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading preset...</p>
          </div>
        </main>
      </AppLayout>
    );
  }

  if (error || !preset || !data) {
    return (
      <AppLayout>
        <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
          <SettingsHeader />
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Preset not found</p>
          </div>
        </main>
      </AppLayout>
    );
  }

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

        {showDeleteAlert && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Are you sure?</AlertTitle>
            <AlertDescription>
              This action cannot be undone. This will permanently delete this
              preset.
            </AlertDescription>
            <div className="mt-4 flex justify-end space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteAlert(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
            <AlertClose onClick={() => setShowDeleteAlert(false)} />
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">
                Edit Preset
              </h2>
              <p className="text-sm text-muted-foreground">
                Modify this preset configuration
              </p>
            </div>

            <Button
              variant="destructive"
              size="sm"
              disabled={isDeleting}
              onClick={() => setShowDeleteAlert(true)}
              type="button"
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="name">Preset Name</Label>
                {preset.pId && (
                  <div className="flex items-center justify-end gap-1 rounded-md bg-muted px-2 py-1 font-mono text-xs font-medium text-muted-foreground">
                    <span>ID:</span>
                    <code className="font-mono">{preset.pId}</code>
                  </div>
                )}
              </div>
              <Input
                id="name"
                value={data.name || ""}
                onChange={(e) =>
                  setData((prev) =>
                    prev ? { ...prev, name: e.target.value } : null,
                  )
                }
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-6">
              <div className="rounded-lg border p-6">
                <h3 className="mb-4 text-lg font-medium">Link Preview Cards</h3>
                <OGSection
                  data={data as any}
                  setData={setData as any}
                  isAllowed={
                    isTrial ||
                    (isPro && allowAdvancedLinkControls) ||
                    isBusiness ||
                    isDatarooms ||
                    isDataroomsPlus
                  }
                  handleUpgradeStateChange={handleUpgradeStateChange}
                  editLink={true}
                  presets={null}
                />
              </div>

              <div className="rounded-lg border p-6">
                <h3 className="mb-4 text-lg font-medium">Basic Settings</h3>
                <EmailProtectionSection
                  data={data as any}
                  setData={setData as any}
                />
                <EmailAuthenticationSection
                  data={data as any}
                  setData={setData as any}
                  isAllowed={
                    isTrial ||
                    (isPro && allowAdvancedLinkControls) ||
                    isBusiness ||
                    isDatarooms ||
                    isDataroomsPlus
                  }
                  handleUpgradeStateChange={handleUpgradeStateChange}
                />

                <AllowNotificationSection
                  data={data as any}
                  setData={setData as any}
                />

                <AllowDownloadSection
                  data={data as any}
                  setData={setData as any}
                />

                <ExpirationInSection
                  data={data as any}
                  setData={setData as any}
                />
              </div>

              <div className="rounded-lg border p-6">
                <h3 className="mb-4 text-lg font-medium">Access Control</h3>
                <PasswordSection data={data as any} setData={setData as any} />
                <AllowListSection
                  data={data as any}
                  setData={setData as any}
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
                  data={data as any}
                  setData={setData as any}
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
                <h3 className="mb-4 text-lg font-medium">Watermark</h3>
                <WatermarkSection
                  data={data as any}
                  setData={setData as any}
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
                  data={data as any}
                  setData={setData as any}
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
                  data={data as any}
                  setData={setData as any}
                  isAllowed={
                    isTrial || isBusiness || isDatarooms || isDataroomsPlus
                  }
                  handleUpgradeStateChange={handleUpgradeStateChange}
                />
                <AgreementSection
                  data={data as any}
                  setData={setData as any}
                  isAllowed={isTrial || isDatarooms || isDataroomsPlus}
                  handleUpgradeStateChange={handleUpgradeStateChange}
                />
                <CustomFieldsSection
                  data={data as any}
                  setData={setData as any}
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
                  data={data as any}
                  setData={setData as any}
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
              {isLoading ? "Saving..." : "Save Changes"}
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
