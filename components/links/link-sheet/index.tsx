import Link from "next/link";
import { useRouter } from "next/router";

import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { LinkAudienceType, LinkPreset, LinkType } from "@prisma/client";
import { RefreshCwIcon } from "lucide-react";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { mutate } from "swr";
import useSWR from "swr";

import { useAnalytics } from "@/lib/analytics";
import { usePlan } from "@/lib/swr/use-billing";
import useDataroomGroups from "@/lib/swr/use-dataroom-groups";
import { useDomains } from "@/lib/swr/use-domains";
import useLimits from "@/lib/swr/use-limits";
import { LinkWithViews, WatermarkConfig } from "@/lib/types";
import { convertDataUrlToFile, fetcher, uploadImage } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ButtonTooltip } from "@/components/ui/tooltip";

import { CustomFieldData } from "./custom-fields-panel";
import { type ItemPermission } from "./dataroom-link-sheet";
import DomainSection from "./domain-section";
import { LinkOptions } from "./link-options";
import TagSection from "./tags/tag-section";

export const DEFAULT_LINK_PROPS = (
  linkType: Omit<LinkType, "WORKFLOW_LINK">,
  groupId: string | null = null,
  showBanner: boolean = true,
) => ({
  id: null,
  name: null,
  domain: null,
  slug: null,
  expiresAt: null,
  password: null,
  emailProtected: true,
  emailAuthenticated: false,
  allowDownload: false,
  allowList: [],
  denyList: [],
  visitorGroupIds: [],
  enableNotification: true,
  enableFeedback: false,
  enableScreenshotProtection: false,
    enableCustomMetatag: false,
  metaTitle: null,
  metaDescription: null,
  metaImage: null,
  metaFavicon: null,
  welcomeMessage: null,
  enableQuestion: false,
  questionText: null,
  questionType: null,
  enableAgreement: false,
  agreementId: null,
  showBanner: linkType === LinkType.DOCUMENT_LINK ? showBanner : false,
  enableWatermark: false,
  watermarkConfig: null,
  audienceType: groupId ? LinkAudienceType.GROUP : LinkAudienceType.GENERAL,
  groupId: groupId,
  customFields: [],
  tags: [],
  enableConversation: false,
  enableAIAgents: false,
  enableUpload: false,
  isFileRequestOnly: false,
  uploadFolderId: null,
  uploadFolderName: "Home",
  uploadFolderIds: [],
  uploadFolders: [],
  enableIndexFile: false,
  permissions: {},
  permissionGroupId: null,
});

export type DEFAULT_LINK_TYPE = {
  id: string | null;
  name: string | null;
  domain: string | null;
  slug: string | null;
  expiresAt: Date | null;
  password: string | null;
  emailProtected: boolean;
  emailAuthenticated: boolean;
  allowDownload: boolean;
  allowList: string[];
  denyList: string[];
  visitorGroupIds: string[];
  enableNotification: boolean;
  enableFeedback: boolean;
  enableScreenshotProtection: boolean;
  enableCustomMetatag: boolean; // metatags
  metaTitle: string | null; // metatags
  metaDescription: string | null; // metatags
  metaImage: string | null; // metatags
  metaFavicon: string | null; // metaFavicon
  welcomeMessage: string | null; // custom welcome message
  enableQuestion?: boolean; // feedback question
  questionText: string | null;
  questionType: string | null;
  enableAgreement: boolean; // agreement
  agreementId: string | null;
  showBanner: boolean;
  enableWatermark: boolean;
  watermarkConfig: WatermarkConfig | null;
  audienceType: LinkAudienceType;
  groupId: string | null;
  customFields: CustomFieldData[];
  tags: string[];
  enableConversation: boolean;
  enableAIAgents: boolean;
  enableUpload: boolean;
  isFileRequestOnly: boolean;
  uploadFolderId: string | null;
  uploadFolderName: string;
  uploadFolderIds: string[];
  uploadFolders: { id: string; name: string; path?: string | null }[];
  enableIndexFile: boolean;
  permissions?: ItemPermission | null; // For dataroom links file permissions
  permissionGroupId?: string | null;
};

export default function LinkSheet({
  isOpen,
  setIsOpen,
  linkType,
  currentLink,
  existingLinks,
  linkTargetId,
  onLinkCreatedNavigate,
}: {
  isOpen: boolean;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
  linkType: Omit<LinkType, "WORKFLOW_LINK">;
  currentLink?: DEFAULT_LINK_TYPE;
  existingLinks?: LinkWithViews[];
  /** When set (e.g. mobile share), used instead of `router.query.id` for API calls */
  linkTargetId?: string | null;
  /** Called after a new link is created (not on update) */
  onLinkCreatedNavigate?: (targetId: string) => void;
}) {
  const router = useRouter();
  const { id: routeId, groupId } = router.query as {
    id?: string;
    groupId?: string;
  };
  const targetId = linkTargetId ?? routeId;

  const { domains } = useDomains({ enabled: isOpen });

  const {
    viewerGroups,
    loading: isLoadingGroups,
    mutate: mutateGroups,
  } = useDataroomGroups({
    dataroomId:
      linkType === LinkType.DATAROOM_LINK
        ? (linkTargetId ?? undefined)
        : undefined,
  });
  const teamInfo = useTeam();
  const { isFree, isPro, isBusiness, isDatarooms, isDataroomsPlus, isTrial } =
    usePlan();
  const { limits } = useLimits();
  const analytics = useAnalytics();
  const [data, setData] = useState<DEFAULT_LINK_TYPE>(
    DEFAULT_LINK_PROPS(linkType, groupId, !isDatarooms),
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [currentPreset, setCurrentPreset] = useState<LinkPreset | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const isPresetsAllowed =
    isTrial ||
    (isPro && limits?.advancedLinkControlsOnPro) ||
    isBusiness ||
    isDatarooms ||
    isDataroomsPlus;

  // Presets
  const { data: presets } = useSWR<LinkPreset[]>(
    teamInfo?.currentTeam?.id
      ? `/api/teams/${teamInfo.currentTeam.id}/presets`
      : null,
    fetcher,
    {
      dedupingInterval: 10000,
    },
  );

  useEffect(() => {
    setData(currentLink || DEFAULT_LINK_PROPS(linkType, groupId, !isDatarooms));
  }, [currentLink]);

  // Handle Command+Enter (Mac) or Ctrl+Enter (Windows/Linux) to submit the form
  useHotkeys(
    "mod+enter",
    (e) => {
      e.preventDefault();
      if (!isSaving && formRef.current) {
        formRef.current.requestSubmit();
      }
    },
    { enabled: isOpen, enableOnFormTags: true },
    [isSaving],
  );

  const handlePreviewLink = async (link: LinkWithViews) => {
    if (link.domainId && isFree) {
      toast.error("You need to upgrade to preview this link");
      return;
    }

    setIsLoading(true);
    const response = await fetch(`/api/links/${link.id}/preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      toast.error("Failed to generate preview link");
      setIsLoading(false);
      return;
    }

    const { previewToken } = await response.json();
    const previewLink = `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${link.id}?previewToken=${previewToken}`;
    setIsLoading(false);
    const linkElement = document.createElement("a");
    linkElement.href = previewLink;
    linkElement.target = "_blank";
    document.body.appendChild(linkElement);
    linkElement.click();

    setTimeout(() => {
      document.body.removeChild(linkElement);
    }, 100);
  };

  const applyPreset = (presetId: string) => {
    const preset = presets?.find((p) => p.id === presetId);
    if (!preset) return;

    setData((prev) => {
      const isGroupLink = prev.audienceType === LinkAudienceType.GROUP;

      return {
        ...prev,
        name: prev.name, // Keep existing name
        domain: prev.domain, // Keep existing domain
        slug: prev.slug, // Keep existing slug
        emailProtected: preset.emailProtected ?? prev.emailProtected,
        emailAuthenticated:
          preset.emailAuthenticated ?? prev.emailAuthenticated,
        // For group links, ignore allow/deny lists from presets as access is controlled by group membership
        allowList: isGroupLink
          ? prev.allowList
          : preset.allowList || prev.allowList,
        denyList: isGroupLink
          ? prev.denyList
          : preset.denyList || prev.denyList,
        password: preset.password || prev.password,
        enableCustomMetatag:
          preset.enableCustomMetaTag ?? prev.enableCustomMetatag,
        metaTitle: preset.metaTitle || prev.metaTitle,
        metaDescription: preset.metaDescription || prev.metaDescription,
        metaImage: preset.metaImage || prev.metaImage,
        metaFavicon: preset.metaFavicon || prev.metaFavicon,
        welcomeMessage: preset.welcomeMessage || prev.welcomeMessage,
        allowDownload: preset.allowDownload || prev.allowDownload,
        enableAgreement: preset.enableAgreement || prev.enableAgreement,
        agreementId: preset.agreementId || prev.agreementId,
        enableScreenshotProtection:
          preset.enableScreenshotProtection || prev.enableScreenshotProtection,
        enableNotification: !!preset.enableNotification,
        showBanner: preset.showBanner ?? prev.showBanner,
      };
    });

    setCurrentPreset(preset);
  };

  const handleSubmit = async (event: any, shouldPreview: boolean = false) => {
    event.preventDefault();

    if (!targetId) {
      toast.error("Missing document or dataroom");
      return;
    }

    setIsSaving(true);

    // Upload the image if it's a data URL
    let blobUrl: string | null =
      data.metaImage && data.metaImage.startsWith("data:")
        ? null
        : data.metaImage;
    if (data.metaImage && data.metaImage.startsWith("data:")) {
      // Convert the data URL to a blob
      const blob = convertDataUrlToFile({ dataUrl: data.metaImage });
      // Upload the blob to vercel storage
      blobUrl = await uploadImage(blob);
      setData({ ...data, metaImage: blobUrl });
    }

    // Upload meta favicon if it's a data URL
    let blobUrlFavicon: string | null =
      data.metaFavicon && data.metaFavicon.startsWith("data:")
        ? null
        : data.metaFavicon;
    if (data.metaFavicon && data.metaFavicon.startsWith("data:")) {
      const blobFavicon = convertDataUrlToFile({ dataUrl: data.metaFavicon });
      blobUrlFavicon = await uploadImage(blobFavicon);
      setData({
        ...data,
        metaFavicon: blobUrlFavicon,
      });
    }

    let endpoint = "/api/links";
    let method = "POST";

    if (currentLink) {
      // Assuming that your endpoint to update links appends the link's ID to the URL
      endpoint = `/api/links/${currentLink.id}`;
      method = "PUT";
    }

    const response = await fetch(endpoint, {
      method: method,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...data,
        metaImage: blobUrl,
        metaFavicon: blobUrlFavicon,
        targetId: targetId,
        linkType: linkType,
        teamId: teamInfo?.currentTeam?.id,
      }),
    });

    if (!response.ok) {
      // handle error with toast message
      const { error } = await response.json();
      toast.error(error);
      setIsSaving(false);
      return;
    }

    const returnedLink = await response.json();
    const endpointTargetType = `${linkType.replace("_LINK", "").toLowerCase()}s`; // "documents" or "datarooms"

    if (currentLink) {
      setIsOpen(false);
      // Update the link in the list of links
      mutate(
        `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}/${encodeURIComponent(
          targetId,
        )}/links`,
        (existingLinks || []).map((link) =>
          link.id === currentLink.id ? returnedLink : link,
        ),
        false,
      );

      // Handle group changes
      if (!!groupId && returnedLink.audienceType === LinkAudienceType.GROUP) {
        // If we're viewing a group page
        if (currentLink.groupId !== returnedLink.groupId) {
          // If the link's group has changed
          if (currentLink.groupId === groupId) {
            // If the link was in the current group but is now in a different group
            // Remove it from the current group's view
            const groupLinks =
              existingLinks?.filter(
                (link) =>
                  link.id !== currentLink.id && link.groupId === groupId,
              ) || [];

            mutate(
              `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}/${encodeURIComponent(
                targetId,
              )}/groups/${groupId}/links`,
              groupLinks,
              false,
            );
          } else if (returnedLink.groupId === groupId) {
            // If the link was in a different group but is now in the current group
            // Add it to the current group's view
            const groupLinks =
              existingLinks?.filter((link) => link.groupId === groupId) || [];

            mutate(
              `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}/${encodeURIComponent(
                targetId,
              )}/groups/${groupId}/links`,
              [returnedLink, ...groupLinks],
              false,
            );
          }
        } else if (returnedLink.groupId === groupId) {
          // If the link's group hasn't changed and it's in the current group
          // Update it in the current group's view
          const groupLinks =
            existingLinks?.filter((link) => link.groupId === groupId) || [];

          mutate(
            `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}/${encodeURIComponent(
              targetId,
            )}/groups/${groupId}/links`,
            groupLinks.map((link) =>
              link.id === currentLink.id ? returnedLink : link,
            ),
            false,
          );
        }
      }

      // Track what changed for analytics
      const changedFields: Record<string, { from: unknown; to: unknown }> = {};
      const trackableFields: (keyof DEFAULT_LINK_TYPE)[] = [
        "name",
        "domain",
        "slug",
        "expiresAt",
        "emailProtected",
        "emailAuthenticated",
        "allowDownload",
        "allowList",
        "denyList",
        "enableNotification",
        "enableFeedback",
        "enableScreenshotProtection",
        "enableCustomMetatag",
        "metaTitle",
        "metaDescription",
        "welcomeMessage",
        "enableQuestion",
        "questionText",
        "questionType",
        "enableAgreement",
        "agreementId",
        "showBanner",
        "enableWatermark",
        "audienceType",
        "groupId",
        "enableConversation",
        "enableAIAgents",
        "enableUpload",
        "isFileRequestOnly",
        "uploadFolderId",
        "uploadFolderIds",
        "enableIndexFile",
        "permissionGroupId",
        "tags",
      ];

      for (const field of trackableFields) {
        if (
          JSON.stringify(currentLink[field]) !== JSON.stringify(data[field])
        ) {
          changedFields[field] = {
            from: currentLink[field],
            to: data[field],
          };
        }
      }

      // Password: log set/unset/changed status only, not actual values
      if (!!currentLink.password !== !!data.password) {
        changedFields.password = {
          from: currentLink.password ? "set" : "unset",
          to: data.password ? "set" : "unset",
        };
      } else if (
        currentLink.password &&
        data.password &&
        currentLink.password !== data.password
      ) {
        changedFields.password = { from: "set", to: "changed" };
      }

      // Image fields: log set/unset status only, not URLs
      if (currentLink.metaImage !== data.metaImage) {
        changedFields.metaImage = {
          from: currentLink.metaImage ? "set" : "unset",
          to: data.metaImage ? "set" : "unset",
        };
      }
      if (currentLink.metaFavicon !== data.metaFavicon) {
        changedFields.metaFavicon = {
          from: currentLink.metaFavicon ? "set" : "unset",
          to: data.metaFavicon ? "set" : "unset",
        };
      }

      // Watermark config: log configured/unset status
      if (
        JSON.stringify(currentLink.watermarkConfig) !==
        JSON.stringify(data.watermarkConfig)
      ) {
        changedFields.watermarkConfig = {
          from: currentLink.watermarkConfig ? "configured" : "unset",
          to: data.watermarkConfig ? "configured" : "unset",
        };
      }

      // Custom fields: log count change
      if (
        JSON.stringify(currentLink.customFields) !==
        JSON.stringify(data.customFields)
      ) {
        changedFields.customFields = {
          from: currentLink.customFields?.length ?? 0,
          to: data.customFields?.length ?? 0,
        };
      }

      analytics.capture("Link Updated", {
        linkId: currentLink.id,
        targetId,
        linkType,
        teamId: teamInfo?.currentTeam?.id,
        customDomain: returnedLink.domainSlug ?? null,
        changes: changedFields,
        changedProperties: Object.keys(changedFields),
      });

      toast.success("Link updated successfully");
    } else {
      setIsOpen(false);

      // Add the new link to the list of links
      mutate(
        `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}/${encodeURIComponent(
          targetId,
        )}/links`,
        [returnedLink, ...(existingLinks || [])],
        false,
      );

      // Also update the group-specific links cache if this is a group link
      if (
        !!groupId &&
        returnedLink.audienceType === LinkAudienceType.GROUP &&
        returnedLink.groupId === groupId
      ) {
        const groupLinks =
          existingLinks?.filter((link) => link.groupId === groupId) || [];
        mutate(
          `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}/${encodeURIComponent(
            targetId,
          )}/groups/${groupId}/links`,
          [returnedLink, ...groupLinks],
          false,
        );
      }

      analytics.capture("Link Added", {
        linkId: returnedLink.id,
        targetId,
        linkType,
        customDomain: returnedLink.domainSlug,
      });

      toast.success("Link created successfully");
      onLinkCreatedNavigate?.(targetId);
    }

    setData(DEFAULT_LINK_PROPS(linkType, groupId));
    setIsSaving(false);

    if (shouldPreview) {
      await handlePreviewLink(returnedLink);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open: boolean) => setIsOpen(open)}>
      <SheetContent className="flex w-[90%] flex-col justify-between border-l border-gray-200 bg-background px-4 text-foreground dark:border-gray-800 dark:bg-gray-900 sm:w-[800px] sm:max-w-4xl md:px-5">
        <SheetHeader className="text-start">
          <SheetTitle>
            {currentLink
              ? `Edit ${currentLink.audienceType === LinkAudienceType.GROUP ? "group" : ""} link`
              : "Create a new link"}
          </SheetTitle>
        </SheetHeader>

        <form
          ref={formRef}
          className="flex grow flex-col"
          onSubmit={(e) => handleSubmit(e, false)}
        >
          <ScrollArea className="flex-grow">
            <div className="h-0 flex-1">
              <div className="flex flex-1 flex-col justify-between pb-6">
                <div className="divide-y divide-gray-200">
                  <Tabs
                    value={data.audienceType}
                    onValueChange={(value) =>
                      setData({
                        ...data,
                        audienceType: value as LinkAudienceType,
                      })
                    }
                  >
                    {linkType === LinkType.DATAROOM_LINK && !!!currentLink ? (
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value={LinkAudienceType.GENERAL}>
                          General
                        </TabsTrigger>
                        {isDatarooms || isDataroomsPlus || isTrial ? (
                          <TabsTrigger value={LinkAudienceType.GROUP}>
                            Group
                          </TabsTrigger>
                        ) : (
                          <UpgradePlanModal
                            clickedPlan={PlanEnum.DataRooms}
                            trigger="add_group_link"
                          >
                            <div className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all">
                              Group
                            </div>
                          </UpgradePlanModal>
                        )}
                      </TabsList>
                    ) : null}

                    <TabsContent value={LinkAudienceType.GENERAL}>
                      {/* GENERAL LINK */}
                      <div className="space-y-6 pt-2">
                        <div className="space-y-2">
                          <Label htmlFor="link-name">Link Name</Label>
                          <Input
                            type="text"
                            name="link-name"
                            id="link-name"
                            placeholder="Recipient's Organization"
                            value={data.name || ""}
                            className="focus:ring-inset"
                            onChange={(e) =>
                              setData({ ...data, name: e.target.value })
                            }
                          />
                        </div>

                        <div className="space-y-2">
                          <DomainSection
                            {...{ data, setData, domains }}
                            linkType={linkType}
                            editLink={!!currentLink}
                          />
                        </div>

                        {/* Preset Selector - only show when creating a new link */}
                        {!currentLink &&
                          isPresetsAllowed &&
                          presets &&
                          presets.length > 0 && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label htmlFor="preset">Link Preset</Label>
                                <Link
                                  href="/settings/presets"
                                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                                >
                                  Manage
                                </Link>
                              </div>
                              <Select onValueChange={applyPreset}>
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select a preset" />
                                </SelectTrigger>
                                <SelectContent>
                                  {presets.map((preset) => (
                                    <SelectItem
                                      key={preset.id}
                                      value={preset.id}
                                    >
                                      {preset.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-muted-foreground">
                                Apply a preset to quickly configure link
                                settings
                              </p>
                            </div>
                          )}

                        <div className="relative flex items-center">
                          <Separator className="absolute bg-muted-foreground" />
                          <div className="relative mx-auto">
                            <span className="bg-background px-2 text-sm text-muted-foreground dark:bg-gray-900">
                              Link Options
                            </span>
                          </div>
                        </div>

                        <LinkOptions
                          data={data}
                          setData={setData}
                          targetId={targetId}
                          linkType={linkType}
                          editLink={!!currentLink}
                          currentPreset={currentPreset}
                        />
                      </div>
                    </TabsContent>

                    <TabsContent value={LinkAudienceType.GROUP}>
                      {/* GROUP LINK */}
                      <div className="space-y-6 pt-2">
                        <div className="space-y-2">
                          <div className="flex w-full items-center justify-between">
                            <Label htmlFor="group-id">Group </Label>
                            <ButtonTooltip content="Refresh groups">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  await mutateGroups();
                                }}
                              >
                                <RefreshCwIcon className="h-4 w-4" />
                              </Button>
                            </ButtonTooltip>
                          </div>
                          <Select
                            onValueChange={(value) => {
                              if (value === "add_group") {
                                // Open the group sheet
                                console.log("add_group redirect");
                                return;
                              }

                              setData({ ...data, groupId: value });
                            }}
                            defaultValue={data.groupId ?? undefined}
                          >
                            <SelectTrigger className="focus:ring-offset-3 flex w-full rounded-md border-0 bg-background py-1.5 text-foreground shadow-sm ring-1 ring-inset ring-input placeholder:text-muted-foreground focus:ring-2 focus:ring-gray-400 sm:text-sm sm:leading-6">
                              <SelectValue placeholder="Select an group" />
                            </SelectTrigger>
                            <SelectContent>
                              {isLoadingGroups ? (
                                <SelectItem value="loading" disabled>
                                  Loading groups...
                                </SelectItem>
                              ) : viewerGroups && viewerGroups.length > 0 ? (
                                viewerGroups.map(({ id, name, _count }) => (
                                  <SelectItem key={id} value={id}>
                                    {name}{" "}
                                    <span className="text-muted-foreground">
                                      ({_count.members} members)
                                    </span>
                                  </SelectItem>
                                ))
                              ) : (
                                <SelectItem value="no-groups" disabled>
                                  No groups available
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="link-name">Link Name</Label>

                          <Input
                            type="text"
                            name="link-name"
                            id="link-name"
                            placeholder={
                              viewerGroups?.find(
                                (group) => group.id === data.groupId,
                              )?.name
                                ? `${
                                    viewerGroups?.find(
                                      (group) => group.id === data.groupId,
                                    )?.name
                                  } Link`
                                : "Group Link"
                            }
                            value={data.name || ""}
                            className="focus:ring-inset"
                            onChange={(e) =>
                              setData({ ...data, name: e.target.value })
                            }
                          />
                        </div>

                        <div className="space-y-2">
                          <DomainSection
                            {...{ data, setData, domains }}
                            linkType={linkType}
                            editLink={!!currentLink}
                          />
                        </div>

                        {/* Preset Selector for Group links - only show when creating a new link */}
                        {!currentLink &&
                          isPresetsAllowed &&
                          presets &&
                          presets.length > 0 && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label htmlFor="preset">Link Preset</Label>
                                <Link
                                  href="/settings/presets"
                                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                                >
                                  Manage
                                </Link>
                              </div>
                              <Select onValueChange={applyPreset}>
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select a preset" />
                                </SelectTrigger>
                                <SelectContent>
                                  {presets.map((preset) => (
                                    <SelectItem
                                      key={preset.id}
                                      value={preset.id}
                                    >
                                      {preset.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-muted-foreground">
                                Apply a preset to quickly configure link
                                settings
                              </p>
                            </div>
                          )}

                        <div className="relative flex items-center">
                          <Separator className="absolute bg-muted-foreground" />
                          <div className="relative mx-auto">
                            <span className="bg-background px-2 text-sm text-muted-foreground dark:bg-gray-900">
                              Link Options
                            </span>
                          </div>
                        </div>

                        <LinkOptions
                          data={data}
                          setData={setData}
                          targetId={targetId}
                          linkType={linkType}
                          editLink={!!currentLink}
                          currentPreset={currentPreset}
                        />
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>

                <Separator className="mb-6 mt-2" />

                <div className="space-y-2">
                  <TagSection
                    {...{ data, setData }}
                    teamId={teamInfo?.currentTeam?.id as string}
                  />
                </div>
              </div>
            </div>
          </ScrollArea>

          <SheetFooter>
            <div className="flex flex-row-reverse items-center gap-2 pt-2">
              <Button
                type="submit"
                loading={isSaving}
                onClick={(e) => handleSubmit(e, false)}
              >
                {currentLink ? "Update Link" : "Save Link"}
              </Button>
              <Button
                type="button"
                variant="outline"
                loading={isLoading}
                onClick={(e) => handleSubmit(e, true)}
              >
                {currentLink ? "Update & Preview" : "Save & Preview"}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
