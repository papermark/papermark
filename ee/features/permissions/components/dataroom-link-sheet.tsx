import Link from "next/link";
import { useRouter } from "next/router";

import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";

import { useHotkeys } from "react-hotkeys-hook";

import { useTeam } from "@/context/team-context";
import {
  ItemType,
  LinkAudienceType,
  LinkPreset,
  LinkType,
} from "@prisma/client";
import { EyeIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";
import useSWR from "swr";
import z from "zod";

import { InviteViewersModal } from "@/ee/features/dataroom-invitations/components/invite-viewers-modal";

import { useAnalytics } from "@/lib/analytics";
import { usePlan } from "@/lib/swr/use-billing";
import { useDataroom } from "@/lib/swr/use-dataroom";
import useDataroomGroups from "@/lib/swr/use-dataroom-groups";
import { useDocument } from "@/lib/swr/use-document";
import { useDomains } from "@/lib/swr/use-domains";
import useLimits from "@/lib/swr/use-limits";
import { LinkWithViews } from "@/lib/types";
import { convertDataUrlToFile, fetcher, uploadImage } from "@/lib/utils";

import {
  DEFAULT_LINK_PROPS as BASE_DEFAULT_LINK_PROPS,
  DEFAULT_LINK_TYPE as BASE_DEFAULT_LINK_TYPE,
} from "@/components/links/link-sheet";
import DomainSection from "@/components/links/link-sheet/domain-section";
import { LinkOptions } from "@/components/links/link-sheet/link-options";
import LinkSuccessSheet from "@/components/links/link-sheet/link-success-sheet";
import TagSection from "@/components/links/link-sheet/tags/tag-section";
import { isDocumentProcessing } from "@/components/documents/document-preview-button";
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
import { BadgeTooltip, ButtonTooltip } from "@/components/ui/tooltip";

import { PermissionsSheet } from "./permissions-sheet";

export const DEFAULT_LINK_PROPS = (
  linkType: LinkType,
  groupId: string | null = null,
  showBanner: boolean = true,
) => ({
  ...BASE_DEFAULT_LINK_PROPS(linkType, groupId, showBanner),
  permissions: null,
});

export type ItemPermission = Record<
  string,
  { view: boolean; download: boolean; itemType: ItemType }
>;

export type DEFAULT_LINK_TYPE = BASE_DEFAULT_LINK_TYPE & {
  permissions?: ItemPermission | null;
};

export function DataroomLinkSheet({
  isOpen,
  setIsOpen,
  linkType,
  currentLink,
  existingLinks,
  linkTargetId,
}: {
  isOpen: boolean;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
  linkType: LinkType;
  currentLink?: DEFAULT_LINK_TYPE;
  existingLinks?: LinkWithViews[];
  linkTargetId: string;
}) {
  const router = useRouter();
  const { groupId } = router.query as {
    groupId?: string;
  };
  const targetId = linkTargetId;

  const { domains } = useDomains({ enabled: isOpen });

  const {
    viewerGroups,
    loading: isLoadingGroups,
    mutate: mutateGroups,
  } = useDataroomGroups({ dataroomId: linkTargetId ?? undefined });
  const { currentTeamId: teamId } = useTeam();
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
  const [showPermissionsSheet, setShowPermissionsSheet] =
    useState<boolean>(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [pendingLinkData, setPendingLinkData] =
    useState<DEFAULT_LINK_TYPE | null>(null);
  const [showSuccessSheet, setShowSuccessSheet] = useState<boolean>(false);
  const [createdLink, setCreatedLink] = useState<LinkWithViews | null>(null);
  const [hasCustomPermissions, setHasCustomPermissions] =
    useState<boolean>(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(false);
  const { dataroom } = useDataroom(linkTargetId);
  const canInviteViewers = isDataroomsPlus;

  // Check if document is processing (only for document links)
  const { document, primaryVersion } = useDocument();
  const isDocumentCurrentlyProcessing = 
    linkType === LinkType.DOCUMENT_LINK && 
    isDocumentProcessing(primaryVersion);

  const isPresetsAllowed =
    isTrial ||
    (isPro && limits?.advancedLinkControlsOnPro) ||
    isBusiness ||
    isDatarooms ||
    isDataroomsPlus;

  // Presets
  const { data: presets } = useSWR<LinkPreset[]>(
    teamId ? `/api/teams/${teamId}/presets` : null,
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
    try {
      const linkId = z.string().cuid().parse(link.id);
      const response = await fetch(`/api/links/${linkId}/preview`, {
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
      const previewLink = `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${linkId}?previewToken=${previewToken}`;
      setIsLoading(false);
      const linkElement = document.createElement("a");
      linkElement.href = previewLink;
      linkElement.target = "_blank";
      document.body.appendChild(linkElement);
      linkElement.click();

      setTimeout(() => {
        document.body.removeChild(linkElement);
      }, 100);
    } catch (error) {
      console.error("Error generating preview link:", error);
      toast.error("Failed to generate preview link");
      setIsLoading(false);
      return;
    }
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

  const handlePermissionsSave = async (permissions: ItemPermission | null) => {
    if (!pendingLinkData) return;

    setIsSaving(true);

    try {
      // Use the unified function for both new and existing links
      await createOrUpdateLinkWithPermissions(
        pendingLinkData,
        permissions,
        false,
        true,
        true,
      );

      // Close the sheets and show success
      setIsOpen(false);
      setShowPermissionsSheet(false);
      setPendingLinkData(null);
    } catch (error) {
      console.error("Error creating/updating link with permissions:", error);
      setIsSaving(false);
    }
  };

  const createOrUpdateLinkWithPermissions = async (
    linkData: DEFAULT_LINK_TYPE,
    permissions: ItemPermission | null,
    shouldPreview: boolean = false,
    showSuccess: boolean = false,
    isPermissionUpdate: boolean = false,
  ) => {
    // Upload the image if it's a data URL
    let blobUrl: string | null =
      linkData.metaImage && linkData.metaImage.startsWith("data:")
        ? null
        : linkData.metaImage;
    if (linkData.metaImage && linkData.metaImage.startsWith("data:")) {
      // Convert the data URL to a blob
      const blob = convertDataUrlToFile({ dataUrl: linkData.metaImage });
      // Upload the blob to vercel storage
      blobUrl = await uploadImage(blob);
    }

    // Upload meta favicon if it's a data URL
    let blobUrlFavicon: string | null =
      linkData.metaFavicon && linkData.metaFavicon.startsWith("data:")
        ? null
        : linkData.metaFavicon;
    if (linkData.metaFavicon && linkData.metaFavicon.startsWith("data:")) {
      const blobFavicon = convertDataUrlToFile({
        dataUrl: linkData.metaFavicon,
      });
      blobUrlFavicon = await uploadImage(blobFavicon);
    }

    const isUpdating = !!currentLink?.id;

    if (isUpdating && !currentLink?.id) {
      toast.error("Invalid link ID for update");
      setIsSaving(false);
      return;
    }

    const customFields = linkData.customFields?.filter((field) =>
      field.label.trim(),
    );

    const response = await fetch(
      isUpdating ? `/api/links/${currentLink.id}` : "/api/links",
      {
        method: isUpdating ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...linkData,
          customFields: customFields,
          metaImage: blobUrl,
          metaFavicon: blobUrlFavicon,
          targetId: targetId,
          linkType: linkType,
          teamId: teamId,
        }),
      },
    );

    if (!response.ok) {
      // handle error with toast message
      const { error } = await response.json();
      toast.error(error);
      setIsSaving(false);
      return;
    }

    const returnedLink = await response.json();

    // Handle permissions
    if (
      isPermissionUpdate &&
      permissions === null &&
      isUpdating &&
      currentLink?.permissionGroupId
    ) {
      // Delete the permission group - database will set permissionGroupId to null automatically
      if (!teamId || !targetId || !currentLink.permissionGroupId) {
        toast.error("Invalid parameters for permission group deletion");
        setIsSaving(false);
        return;
      }

      try {
        const targetIdParsed = z.string().cuid().parse(targetId);
        const teamIdParsed = z.string().cuid().parse(teamId);
        const permissionGroupIdParsed = z
          .string()
          .cuid()
          .parse(currentLink.permissionGroupId);

        const deleteResponse = await fetch(
          `/api/teams/${teamIdParsed}/datarooms/${targetIdParsed}/permission-groups/${permissionGroupIdParsed}`,
          {
            method: "DELETE",
          },
        );

        if (!deleteResponse.ok) {
          // Handle error with toast message
          try {
            const errorData = await deleteResponse.json();
            toast.error(errorData.error || "Failed to delete permission group");
          } catch {
            toast.error("Failed to delete permission group");
          }
          setIsSaving(false);
          return;
        }

        returnedLink.permissionGroupId = null;

        // Show success message
        toast.success("Permission group deleted successfully");

        // Refresh the links cache
        mutate(
          `/api/teams/${teamId}/datarooms/${encodeURIComponent(targetId)}/links`,
        );

        // Clear the permission group cache instead of invalidating to avoid 404
        mutate(
          `/api/teams/${teamId}/datarooms/${targetId}/permission-groups/${currentLink.permissionGroupId}`,
          undefined,
          false,
        );
      } catch (error) {
        console.error("Error deleting permission group:", error);
        toast.error("Failed to delete permission group");
        setIsSaving(false);
        return;
      }
    } else if (permissions !== null) {
      // Only handle permission group operations if we have specific permissions to set
      await handlePermissionGroupOperations(
        returnedLink,
        permissions,
        isUpdating,
      );
    }

    // Handle UI updates and notifications
    await handlePostSaveOperations(
      returnedLink,
      isUpdating,
      showSuccess,
      shouldPreview,
      permissions,
    );

    setData(DEFAULT_LINK_PROPS(linkType, groupId));
    setIsSaving(false);
  };

  const handlePermissionGroupOperations = async (
    link: any,
    permissions: ItemPermission,
    isUpdating: boolean,
  ) => {
    // Create/update permission group with the provided permissions
    if (isUpdating && currentLink?.permissionGroupId) {
      if (!teamId || !targetId || !currentLink.permissionGroupId) {
        console.error("Invalid parameters for permission group update");
        return;
      }

      try {
        const targetIdParsed = z.string().cuid().parse(targetId);
        const teamIdParsed = z.string().cuid().parse(teamId);
        const permissionGroupIdParsed = z
          .string()
          .cuid()
          .parse(currentLink.permissionGroupId);
        // Update existing permission group
        const response = await fetch(
          `/api/teams/${teamIdParsed}/datarooms/${targetIdParsed}/permission-groups/${permissionGroupIdParsed}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              permissions: permissions,
            }),
          },
        );

        if (response.ok) {
          // Invalidate the permission group cache
          mutate(
            `/api/teams/${teamIdParsed}/datarooms/${targetIdParsed}/permission-groups/${permissionGroupIdParsed}`,
          );
        }
      } catch (error) {
        console.error("Error updating permission group:", error);
        toast.error("Failed to update permission group");
        setIsSaving(false);
        return;
      }
    } else {
      if (!teamId || !targetId) {
        console.error("Invalid parameters for permission group creation");
        return;
      }

      try {
        const targetIdParsed = z.string().cuid().parse(targetId);
        const teamIdParsed = z.string().cuid().parse(teamId);
        // Create new permission group
        const response = await fetch(
          `/api/teams/${teamIdParsed}/datarooms/${targetIdParsed}/permission-groups`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              permissions: permissions,
              linkId: link.id,
            }),
          },
        );

        if (response.ok) {
          const { permissionGroup: newPermissionGroup, _ } =
            await response.json();
          // Cache the new permission group data
          mutate(
            `/api/teams/${teamId}/datarooms/${targetId}/permission-groups/${newPermissionGroup.id}`,
            newPermissionGroup,
            false,
          );

          // Update the link with the new permission group ID
          if (newPermissionGroup.id) {
            link.permissionGroupId = newPermissionGroup.id;
          }
        }
      } catch (error) {
        console.error("Error creating/updating permission group:", error);
        toast.error("Failed to create/update permission group");
        setIsSaving(false);
        return;
      }
    }
  };

  const handlePostSaveOperations = async (
    returnedLink: any,
    isUpdating: boolean,
    showSuccess: boolean,
    shouldPreview: boolean,
    permissions: ItemPermission | null,
  ) => {
    if (!targetId || !teamId) {
      setIsSaving(false);
      return;
    }

    const endpointTargetType = `${linkType.replace("_LINK", "").toLowerCase()}s`; // "documents" or "datarooms"

    if (isUpdating) {
      setIsOpen(false);
      // Update the link in the list of links
      mutate(
        `/api/teams/${teamId}/${endpointTargetType}/${encodeURIComponent(
          targetId,
        )}/links`,
        (existingLinks || []).map((link) =>
          link.id === currentLink!.id ? returnedLink : link,
        ),
        false,
      );

      // Handle group changes
      if (!!groupId && returnedLink.audienceType === LinkAudienceType.GROUP) {
        // If we're viewing a group page
        if (currentLink!.groupId !== returnedLink.groupId) {
          // If the link's group has changed
          if (currentLink!.groupId === groupId) {
            // If the link was in the current group but is now in a different group
            // Remove it from the current group's view
            const groupLinks =
              existingLinks?.filter(
                (link) =>
                  link.id !== currentLink!.id && link.groupId === groupId,
              ) || [];

            mutate(
              `/api/teams/${teamId}/${endpointTargetType}/${encodeURIComponent(
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
              `/api/teams/${teamId}/${endpointTargetType}/${encodeURIComponent(
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
            `/api/teams/${teamId}/${endpointTargetType}/${encodeURIComponent(
              targetId,
            )}/groups/${groupId}/links`,
            groupLinks.map((link) =>
              link.id === currentLink!.id ? returnedLink : link,
            ),
            false,
          );
        }
      }

      // Track what changed for analytics
      const changedFields: Record<string, { from: unknown; to: unknown }> =
        {};
      const trackableFields: (keyof BASE_DEFAULT_LINK_TYPE)[] = [
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
        "enableIndexFile",
        "permissionGroupId",
        "tags",
      ];

      for (const field of trackableFields) {
        if (
          JSON.stringify(currentLink![field]) !== JSON.stringify(data[field])
        ) {
          changedFields[field] = {
            from: currentLink![field],
            to: data[field],
          };
        }
      }

      // Password: log set/unset/changed status only, not actual values
      if (!!currentLink!.password !== !!data.password) {
        changedFields.password = {
          from: currentLink!.password ? "set" : "unset",
          to: data.password ? "set" : "unset",
        };
      } else if (
        currentLink!.password &&
        data.password &&
        currentLink!.password !== data.password
      ) {
        changedFields.password = { from: "set", to: "changed" };
      }

      // Image fields: log set/unset status only, not URLs
      if (currentLink!.metaImage !== data.metaImage) {
        changedFields.metaImage = {
          from: currentLink!.metaImage ? "set" : "unset",
          to: data.metaImage ? "set" : "unset",
        };
      }
      if (currentLink!.metaFavicon !== data.metaFavicon) {
        changedFields.metaFavicon = {
          from: currentLink!.metaFavicon ? "set" : "unset",
          to: data.metaFavicon ? "set" : "unset",
        };
      }

      // Watermark config: log configured/unset status
      if (
        JSON.stringify(currentLink!.watermarkConfig) !==
        JSON.stringify(data.watermarkConfig)
      ) {
        changedFields.watermarkConfig = {
          from: currentLink!.watermarkConfig ? "configured" : "unset",
          to: data.watermarkConfig ? "configured" : "unset",
        };
      }

      // Custom fields: log count change
      if (
        JSON.stringify(currentLink!.customFields) !==
        JSON.stringify(data.customFields)
      ) {
        changedFields.customFields = {
          from: currentLink!.customFields?.length ?? 0,
          to: data.customFields?.length ?? 0,
        };
      }

      analytics.capture("Link Updated", {
        linkId: currentLink!.id,
        targetId,
        linkType,
        teamId,
        customDomain: returnedLink.domainSlug ?? null,
        changes: changedFields,
        changedProperties: Object.keys(changedFields),
      });

      toast.success("Link updated successfully");
    } else {
      // Add the new link to the list of links
      mutate(
        `/api/teams/${teamId}/${endpointTargetType}/${encodeURIComponent(
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
          `/api/teams/${teamId}/${endpointTargetType}/${encodeURIComponent(
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

      if (showSuccess) {
        // Show success sheet instead of closing
        setIsOpen(false);
        setShowPermissionsSheet(false);
        setPendingLinkData(null);
        setCreatedLink(returnedLink);
        setHasCustomPermissions(
          permissions !== null &&
            permissions &&
            Object.keys(permissions).length > 0,
        );
        setShowSuccessSheet(true);
      } else {
        setIsOpen(false);
        setShowPermissionsSheet(false);
        setPendingLinkData(null);
        toast.success("Link created successfully");
        const isOnPermissionsPage = router.asPath.includes("/permissions");
        if (linkType === LinkType.DATAROOM_LINK && !isOnPermissionsPage) {
          router.push(`/datarooms/${targetId}/permissions`);
        }
      }
    }

    if (shouldPreview) {
      await handlePreviewLink(returnedLink);
    }
  };

  // Remove the old createLinkWithPermissions function and replace it with a simple wrapper
  const createLinkWithPermissions = async (
    linkData: DEFAULT_LINK_TYPE,
    shouldPreview: boolean = false,
    showSuccess: boolean = false,
  ) => {
    if (!targetId) {
      toast.error("Missing dataroom");
      return;
    }
    // For backward compatibility, extract permissions from linkData
    setIsSaving(true);
    const permissions = linkData.permissions || null;
    await createOrUpdateLinkWithPermissions(
      linkData,
      permissions,
      shouldPreview,
      showSuccess,
      false,
    );
  };

  const handleSubmit = async (
    event: any,
    shouldPreview: boolean = false,
    shouldManagePermissions: boolean = false,
  ) => {
    event.preventDefault();

    if (!targetId) {
      toast.error("Missing dataroom");
      return;
    }

    if (shouldManagePermissions && linkType === LinkType.DATAROOM_LINK) {
      // Store the link data and show permissions sheet
      setPendingLinkData(data);
      setShowPermissionsSheet(true);
      return;
    }
    const showSuccess = !currentLink && !shouldPreview;
    await createLinkWithPermissions(data, shouldPreview, showSuccess);
  };

  const handleCreateAnother = () => {
    // Close success sheet and open new link sheet
    setShowSuccessSheet(false);
    setCreatedLink(null);
    setHasCustomPermissions(false);
    setData(DEFAULT_LINK_PROPS(linkType, groupId));
    setIsOpen(true);
  };

  return (
    <>
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
                      {/* {linkType === LinkType.DATAROOM_LINK && !!!currentLink ? (
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
                    ) : null} */}

                      {/* GENERAL LINK */}
                      <TabsContent value={LinkAudienceType.GENERAL}>
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

                      {/* GROUP LINK */}
                      <TabsContent value={LinkAudienceType.GROUP}>
                        <div className="space-y-6 pt-2">
                          <div className="space-y-2">
                            <div className="flex w-full items-center justify-between">
                              <Label htmlFor="group-id">Group</Label>
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
                      teamId={teamId as string}
                    />
                  </div>
                </div>
              </div>
            </ScrollArea>

            <SheetFooter>
              <div className="flex flex-row-reverse items-center gap-2 pt-2">
                {linkType === LinkType.DATAROOM_LINK &&
                  data?.audienceType !== LinkAudienceType.GROUP && (
                    <Button
                      type="button"
                      variant="default"
                      onClick={(e) => handleSubmit(e, false, true)}
                    >
                      Manage File Permissions
                    </Button>
                  )}
                <Button
                  type="button"
                  variant={
                    linkType === LinkType.DOCUMENT_LINK ||
                    (linkType === LinkType.DATAROOM_LINK &&
                      data?.audienceType === LinkAudienceType.GROUP)
                      ? "default"
                      : "outline"
                  }
                  loading={isSaving}
                  onClick={(e) => handleSubmit(e, false)}
                >
                  {currentLink ? "Update Link" : "Save & Share"}
                </Button>
                <BadgeTooltip
                  content={currentLink ? "Update & Preview" : "Save & Preview"}
                >
                  <Button
                    type="button"
                    variant="link"
                    loading={isLoading}
                    disabled={isDocumentCurrentlyProcessing}
                    onClick={(e) => handleSubmit(e, true)}
                    className="flex items-center gap-2"
                  >
                    <EyeIcon className="h-4 w-4" />
                  </Button>
                </BadgeTooltip>
              </div>
            </SheetFooter>
          </form>
        </SheetContent>

        <PermissionsSheet
          isOpen={showPermissionsSheet}
          setIsOpen={(open: boolean) => {
            setShowPermissionsSheet(open);
            if (!open) {
              setShowSuccessSheet(true);
            }
          }}
          dataroomId={targetId!}
          linkId={currentLink?.id ?? undefined}
          permissionGroupId={currentLink?.permissionGroupId ?? undefined}
          onSave={handlePermissionsSave}
        />
      </Sheet>

      {createdLink && (
        <LinkSuccessSheet
          isOpen={showSuccessSheet}
          setIsOpen={setShowSuccessSheet}
          link={createdLink}
          hasCustomPermissions={hasCustomPermissions}
          onCreateAnother={handleCreateAnother}
          onInviteViewers={() => setIsInviteModalOpen(true)}
        />
      )}

      {createdLink && (
        <InviteViewersModal
          open={isInviteModalOpen}
          setOpen={setIsInviteModalOpen}
          dataroomId={targetId}
          dataroomName={dataroom?.name ?? "this dataroom"}
          linkId={createdLink.id}
          canSend={canInviteViewers}
        />
      )}
    </>
  );
}
