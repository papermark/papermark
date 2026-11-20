import Link from "next/link";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import { BannerEditor } from "@/ee/features/branding/components/banner-editor";
import { BrandingLinkPreviewForm } from "@/ee/features/branding/components/branding-link-preview-form";
import { BrandingPreviewChrome } from "@/ee/features/branding/components/branding-preview-chrome";
import { CollapsibleBrandingSection } from "@/ee/features/branding/components/collapsible-branding-section";
import { DataroomLayoutPresetCards } from "@/ee/features/branding/components/dataroom-layout-preset-cards";
import {
  DRAFT_TEAM_BRAND_ID,
  TeamBrandSwitcher,
  nextTeamBrandName,
} from "@/ee/features/branding/components/team-brand-switcher";
import {
  AUTO_FILL_NOT_FOUND_MESSAGE,
  autoFillHasBrandAssets,
} from "@/ee/features/branding/lib/auto-fill-result";
import {
  CARD_LAYOUT_OPTIONS,
  type DataroomCardLayout,
  type DataroomLayoutCardId,
  type DataroomViewerHeaderStyle,
  asDataroomCardLayout,
  asDataroomViewerHeaderStyle,
  inferDataroomViewerLayoutPreset,
} from "@/ee/features/branding/lib/dataroom-viewer-layout";
import { PlanEnum } from "@/ee/stripe/constants";
import { Check, CircleHelpIcon, CrownIcon, UploadIcon } from "lucide-react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import sanitizeHtml from "sanitize-html";
import { toast } from "sonner";
import { mutate } from "swr";
import { useDebounce } from "use-debounce";

import { useFeatureFlags } from "@/lib/hooks/use-feature-flags";
import { usePlan } from "@/lib/swr/use-billing";
import { useBrand, useBrands } from "@/lib/swr/use-brand";
import { cn, convertDataUrlToFile, uploadImage } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import AppLayout from "@/components/layouts/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FadeScrollArea } from "@/components/ui/fade-scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LoadingSpinner from "@/components/ui/loading-spinner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { BadgeTooltip } from "@/components/ui/tooltip";
import { UpgradeButton } from "@/components/ui/upgrade-button";
import { DataroomBannerMedia } from "@/components/view/dataroom/dataroom-banner-media";

export default function Branding() {
  const teamInfo = useTeam();
  const { brand } = useBrand();
  const {
    brands,
    defaultBrandId,
    loading: brandsLoading,
    mutate: mutateBrands,
  } = useBrands();
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("Default");
  const isDraftBrand = selectedBrandId === DRAFT_TEAM_BRAND_ID;
  const persistedBrandId = isDraftBrand ? null : selectedBrandId;
  const selectedBrand = isDraftBrand
    ? null
    : persistedBrandId
      ? (brands.find((item) => item.id === persistedBrandId) ??
        (brand?.id === persistedBrandId ? brand : null))
      : (brand ?? null);
  const { plan, isTrial, isBusiness, isDatarooms, isDataroomsPlus } = usePlan();
  const { isFeatureEnabled } = useFeatureFlags();
  const customPrivacyUrlEnabled = isFeatureEnabled("customPrivacyUrl");

  const [brandColor, setBrandColor] = useState<string>("#000000");
  const [accentColor, setAccentColor] = useState<string>("#030712");
  const [accentButtonColor, setAccentButtonColor] = useState<string>("#000000");
  const [ctaEnabled, setCtaEnabled] = useState<boolean>(false);
  const [ctaLabel, setCtaLabel] = useState<string>("");
  const [ctaUrl, setCtaUrl] = useState<string>("");
  const [logo, setLogo] = useState<string | null>(null);
  const [hideLogo, setHideLogo] = useState<boolean>(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [bannerBlobUrl, setBannerBlobUrl] = useState<string | null>(null);
  const DEFAULT_WELCOME_MESSAGE = "Your action is requested to continue";
  const [welcomeMessage, setWelcomeMessage] = useState<string>(
    DEFAULT_WELCOME_MESSAGE,
  );
  const [welcomeEnabled, setWelcomeEnabled] = useState<boolean>(false);
  const [previewTab, setPreviewTab] = useState<string>("document-view");
  const [settingsTab, setSettingsTab] = useState<string>("branding");
  const [applyAccentColorToDataroomView, setApplyAccentColorToDataroomView] =
    useState<boolean>(false);
  const [debouncedBrandColor] = useDebounce(brandColor, 300);
  const [debouncedAccentColor] = useDebounce(accentColor, 300);
  const [debouncedAccentButtonColor] = useDebounce(accentButtonColor, 300);
  const [debouncedWelcomeMessage] = useDebounce(welcomeMessage, 500);
  const [debouncedCtaLabel] = useDebounce(ctaLabel, 400);
  const [debouncedCtaUrl] = useDebounce(ctaUrl, 400);
  const [fileError, setFileError] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [bannerDragActive, setBannerDragActive] = useState(false);
  const [welcomeMessageError, setWelcomeMessageError] = useState<string | null>(
    null,
  );

  // Custom Link Preview (Open Graph meta defaults). Inherits down to each
  // dataroom and link; per-link / per-dataroom values can still override.
  const [linkPreviewEnabled, setLinkPreviewEnabled] = useState<boolean>(false);
  const [linkPreviewTitle, setLinkPreviewTitle] = useState<string>("");
  const [linkPreviewDescription, setLinkPreviewDescription] =
    useState<string>("");
  const [linkPreviewImage, setLinkPreviewImage] = useState<string | null>(null);
  const [linkPreviewFavicon, setLinkPreviewFavicon] = useState<string | null>(
    null,
  );

  const [privacyPolicyEnabled, setPrivacyPolicyEnabled] =
    useState<boolean>(false);
  const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState<string>("");
  const [privacyPolicyUrlError, setPrivacyPolicyUrlError] = useState<
    string | null
  >(null);

  // Auto-fill from website (brand lookup)
  const [autoFillUrl, setAutoFillUrl] = useState<string>("");
  const [autoFillLoading, setAutoFillLoading] = useState<boolean>(false);

  // Custom welcome message + CTA require Business, Data Rooms, or trial
  const hasDataroomAccess =
    isBusiness || isDatarooms || isDataroomsPlus || isTrial;
  const hasBusinessMessagingAccess =
    isBusiness || isDatarooms || isDataroomsPlus || isTrial;

  // Layouts visibility: Business+ or any dataroom trial sees the Layouts tab.
  // Layouts save: only Trial / DataRooms plans can persist — Business gets the
  // "Upgrade to save" path that opens the DataRooms upgrade modal.
  const hasLayoutVisibility =
    isBusiness || isDatarooms || isDataroomsPlus || isTrial;
  const hasLayoutSaveAccess = isDatarooms || isDataroomsPlus || isTrial;

  // Dataroom layout state (mirrors per-dataroom branding shape)
  const [cardLayout, setCardLayout] = useState<DataroomCardLayout>("LIST");
  const [showFolderTree, setShowFolderTree] = useState<boolean>(true);
  const [viewerHeaderStyle, setViewerHeaderStyle] =
    useState<DataroomViewerHeaderStyle>("DEFAULT");
  const [hideFolderIconsInMain, setHideFolderIconsInMain] =
    useState<boolean>(false);
  const [upgradeLayoutsModalOpen, setUpgradeLayoutsModalOpen] =
    useState<boolean>(false);
  const [upgradeMessagingModalOpen, setUpgradeMessagingModalOpen] =
    useState<boolean>(false);

  // Snapshot of the loaded layout values so we can detect "dirty" changes the
  // current plan isn't allowed to persist.
  const initialLayoutSnapshotRef = useRef<{
    cardLayout: DataroomCardLayout;
    showFolderTree: boolean;
    viewerHeaderStyle: DataroomViewerHeaderStyle;
    hideFolderIconsInMain: boolean;
  } | null>(null);

  const derivedLayoutPreset = useMemo(
    () =>
      inferDataroomViewerLayoutPreset({
        cardLayout,
        showFolderTree,
        hideFolderIconsInMain,
        viewerHeaderStyle,
      }),
    [cardLayout, showFolderTree, hideFolderIconsInMain, viewerHeaderStyle],
  );

  const layoutHasUnsavedChanges = useMemo(() => {
    const initial = initialLayoutSnapshotRef.current;
    if (!initial) return false;
    return (
      initial.cardLayout !== cardLayout ||
      initial.showFolderTree !== showFolderTree ||
      initial.viewerHeaderStyle !== viewerHeaderStyle ||
      initial.hideFolderIconsInMain !== hideFolderIconsInMain
    );
  }, [cardLayout, showFolderTree, viewerHeaderStyle, hideFolderIconsInMain]);

  const layoutBlocksSave = !hasLayoutSaveAccess && layoutHasUnsavedChanges;

  const applyLayoutPreset = (id: DataroomLayoutCardId) => {
    switch (id) {
      case "STANDARD":
        setCardLayout("LIST");
        setShowFolderTree(true);
        setViewerHeaderStyle("DEFAULT");
        setHideFolderIconsInMain(false);
        break;
      case "STRICT":
        setCardLayout("COMPACT");
        setShowFolderTree(false);
        setViewerHeaderStyle("DEFAULT");
        setHideFolderIconsInMain(true);
        break;
      case "MODERN":
        setCardLayout("COMPACT");
        setShowFolderTree(false);
        setViewerHeaderStyle("SPLIT");
        setHideFolderIconsInMain(true);
        break;
      case "NOTION":
        setCardLayout("GRID");
        setShowFolderTree(false);
        setViewerHeaderStyle("NOTION");
        setHideFolderIconsInMain(false);
        break;
    }
  };

  // Front-page preview mirrors viewer behaviour: when toggle is off, the
  // viewer falls back to the default message regardless of saved value.
  const previewWelcomeMessage =
    hasBusinessMessagingAccess && welcomeEnabled
      ? debouncedWelcomeMessage
      : DEFAULT_WELCOME_MESSAGE;
  const previewCtaLabel =
    hasBusinessMessagingAccess && ctaEnabled
      ? debouncedCtaLabel.trim() || "Book a call"
      : "";
  const previewCtaUrl =
    hasBusinessMessagingAccess && ctaEnabled
      ? debouncedCtaUrl.trim() || "#"
      : "";

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleAutoFill = async () => {
    if (!autoFillUrl.trim()) return;
    setAutoFillLoading(true);
    try {
      const res = await fetch("/api/branding/auto-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: autoFillUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not load brand");
        return;
      }
      if (!autoFillHasBrandAssets(data, { allowBanner: hasDataroomAccess })) {
        toast.error(AUTO_FILL_NOT_FOUND_MESSAGE);
        return;
      }
      if (data.logo) {
        setLogo(data.logo);
        setHideLogo(false);
        setBlobUrl(null);
      }
      if (hasDataroomAccess && data.banner) {
        setBanner(data.banner);
        setBannerBlobUrl(null);
      }
      if (data.brandColor) setBrandColor(data.brandColor);
      if (data.accentColor) setAccentColor(data.accentColor);
      if (data.accentButtonColor) setAccentButtonColor(data.accentButtonColor);
      toast.success(
        `Loaded ${data.name ?? data.domain}. Review and click Save changes.`,
      );
    } catch (err) {
      toast.error("Lookup failed");
    } finally {
      setAutoFillLoading(false);
    }
  };

  // Welcome message validation
  const MAX_WELCOME_MESSAGE_LENGTH = 80; // Roughly 2 lines of text

  const validateWelcomeMessage = (message: string): string | null => {
    if (!message.trim()) {
      return "Welcome message cannot be empty";
    }

    // Strip HTML tags and validate plain text only
    const sanitized = sanitizeHtml(message, {
      allowedTags: [],
      allowedAttributes: {},
    });

    if (sanitized !== message) {
      return "Welcome message must contain only plain text";
    }

    if (sanitized.length > MAX_WELCOME_MESSAGE_LENGTH) {
      return `Welcome message must be ${MAX_WELCOME_MESSAGE_LENGTH} characters or less (currently ${sanitized.length})`;
    }

    return null;
  };

  const onChangeLogo = useCallback(
    (e: any) => {
      setFileError(null);
      const file = e.target.files[0];
      if (file) {
        if (file.size / 1024 / 1024 > 2) {
          setFileError("File size too big (max 2MB)");
        } else if (file.type !== "image/png" && file.type !== "image/jpeg") {
          setFileError("File type not supported (.png or .jpg only)");
        } else {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            setLogo(dataUrl);
            setHideLogo(false);
            // create a blob url for preview
            const blob = convertDataUrlToFile({ dataUrl });
            const blobUrl = URL.createObjectURL(blob);
            setBlobUrl(blobUrl);
          };
          reader.readAsDataURL(file);
        }
      }
    },
    [setLogo],
  );

  const onChangeBanner = useCallback(
    (e: any) => {
      setBannerError(null);
      const file = e.target.files[0];
      if (file) {
        if (file.size / 1024 / 1024 > 2) {
          setBannerError("File size too big (max 2MB)");
        } else if (file.type !== "image/png" && file.type !== "image/jpeg") {
          setBannerError("File type not supported (.png or .jpg only)");
        } else {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            setBanner(dataUrl);
            // create a blob url for preview
            const blob = convertDataUrlToFile({ dataUrl });
            const blobUrl = URL.createObjectURL(blob);
            setBannerBlobUrl(blobUrl);
          };
          reader.readAsDataURL(file);
        }
      }
    },
    [setBanner],
  );

  // Revoke object URLs whenever they're replaced or the component unmounts to
  // avoid leaking blob storage across re-uploads and navigations.
  useEffect(() => {
    if (!blobUrl) return;
    return () => {
      URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  useEffect(() => {
    if (!bannerBlobUrl) return;
    return () => {
      URL.revokeObjectURL(bannerBlobUrl);
    };
  }, [bannerBlobUrl]);

  useEffect(() => {
    if (!selectedBrandId && defaultBrandId) {
      setSelectedBrandId(defaultBrandId);
    }
  }, [defaultBrandId, selectedBrandId]);

  const applyEmptyBrandForm = (name: string) => {
    setBrandName(name);
    setBrandColor("#000000");
    setAccentColor("#030712");
    setAccentButtonColor("#000000");
    setLogo(null);
    setHideLogo(false);
    setBanner(null);
    setApplyAccentColorToDataroomView(false);
    setCtaEnabled(false);
    setCtaLabel("");
    setCtaUrl("");
    setPrivacyPolicyEnabled(false);
    setPrivacyPolicyUrl("");
    setPrivacyPolicyUrlError(null);
    setWelcomeMessage(DEFAULT_WELCOME_MESSAGE);
    setWelcomeEnabled(false);
    setWelcomeMessageError(null);
    setLinkPreviewEnabled(false);
    setLinkPreviewTitle("");
    setLinkPreviewDescription("");
    setLinkPreviewImage(null);
    setLinkPreviewFavicon(null);
    setCardLayout("LIST");
    setShowFolderTree(true);
    setViewerHeaderStyle("DEFAULT");
    setHideFolderIconsInMain(false);
    setFileError(null);
    setBannerError(null);
    initialLayoutSnapshotRef.current = {
      cardLayout: "LIST",
      showFolderTree: true,
      viewerHeaderStyle: "DEFAULT",
      hideFolderIconsInMain: false,
    };
  };

  useEffect(() => {
    if (isDraftBrand) return;
    if (brandsLoading && brand === undefined) return;
    if (persistedBrandId && !selectedBrand) return;

    if (selectedBrand) {
      setBrandName(selectedBrand.name || "Default");
      setBrandColor(selectedBrand.brandColor || "#000000");
      setAccentColor(selectedBrand.accentColor || "#FFFFFF");
      setAccentButtonColor(
        selectedBrand.accentButtonColor ||
          selectedBrand.brandColor ||
          "#000000",
      );
      setLogo(selectedBrand.logo || null);
      setHideLogo(!!selectedBrand.hideLogo);
      setBanner(selectedBrand.banner || null);
      setApplyAccentColorToDataroomView(
        selectedBrand.applyAccentColorToDataroomView ?? false,
      );
      const initialCtaLabel = selectedBrand.ctaLabel ?? "";
      const initialCtaUrl = selectedBrand.ctaUrl ?? "";
      setCtaLabel(initialCtaLabel);
      setCtaUrl(initialCtaUrl);
      setCtaEnabled(!!(initialCtaLabel || initialCtaUrl));
      const initialPrivacyPolicyUrl = selectedBrand.privacyPolicyUrl ?? "";
      setPrivacyPolicyUrl(initialPrivacyPolicyUrl);
      setPrivacyPolicyEnabled(!!initialPrivacyPolicyUrl);
      setPrivacyPolicyUrlError(null);
      const savedMessage = selectedBrand.welcomeMessage ?? null;
      const message = savedMessage || DEFAULT_WELCOME_MESSAGE;
      setWelcomeMessage(message);
      setWelcomeEnabled(
        !!savedMessage && savedMessage !== DEFAULT_WELCOME_MESSAGE,
      );
      // Validate existing message
      const error = validateWelcomeMessage(message);
      setWelcomeMessageError(error);
      setLinkPreviewEnabled(selectedBrand.customLinkPreviewEnabled === true);
      setLinkPreviewTitle(selectedBrand.linkPreviewTitle ?? "");
      setLinkPreviewDescription(selectedBrand.linkPreviewDescription ?? "");
      setLinkPreviewImage(selectedBrand.linkPreviewImage ?? null);
      setLinkPreviewFavicon(selectedBrand.linkPreviewFavicon ?? null);

      const loadedCardLayout = asDataroomCardLayout(selectedBrand.cardLayout);
      const loadedShowFolderTree = selectedBrand.showFolderTree ?? true;
      const loadedHeaderStyle = asDataroomViewerHeaderStyle(
        selectedBrand.viewerHeaderStyle,
      );
      const loadedHideFolderIcons =
        selectedBrand.hideFolderIconsInMain ?? false;
      setCardLayout(loadedCardLayout);
      setShowFolderTree(loadedShowFolderTree);
      setViewerHeaderStyle(loadedHeaderStyle);
      setHideFolderIconsInMain(loadedHideFolderIcons);
      initialLayoutSnapshotRef.current = {
        cardLayout: loadedCardLayout,
        showFolderTree: loadedShowFolderTree,
        viewerHeaderStyle: loadedHeaderStyle,
        hideFolderIconsInMain: loadedHideFolderIcons,
      };
      return;
    }

    applyEmptyBrandForm("Default");
  }, [brand, brandsLoading, isDraftBrand, persistedBrandId, selectedBrand]);

  // Mirrors the server-side check in `validateRedirectUrl`: HTTPS only.
  const validatePrivacyPolicyUrl = (url: string): string | null => {
    const trimmed = url.trim();
    if (!trimmed) return "Privacy policy URL cannot be empty";

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return "Enter a valid URL, e.g. https://example.com/privacy";
    }

    if (parsed.protocol !== "https:") {
      return "Privacy policy URL must use HTTPS";
    }

    return null;
  };

  const handlePrivacyPolicyUrlChange = (value: string) => {
    setPrivacyPolicyUrl(value);
    setPrivacyPolicyUrlError(
      value.trim() ? validatePrivacyPolicyUrl(value) : null,
    );
  };

  // Handle welcome message change with validation
  const handleWelcomeMessageChange = (value: string) => {
    setWelcomeMessage(value);
    const error = validateWelcomeMessage(value);
    setWelcomeMessageError(error);
  };

  const saveBranding = async (e: any) => {
    e.preventDefault();

    // Block the save when the user has dirty layout changes but no save tier.
    // The dataroom-branding page uses the exact same pattern; opens the same
    // upgrade modal so the cross-sell highlights the "Dataroom viewer layouts"
    // line on the Data Rooms plan card.
    if (layoutBlocksSave) {
      setUpgradeLayoutsModalOpen(true);
      return;
    }

    if (hasBusinessMessagingAccess) {
      const welcomeError = validateWelcomeMessage(welcomeMessage);
      if (welcomeError) {
        setWelcomeMessageError(welcomeError);
        toast.error("Please fix the validation errors before saving");
        return;
      }
    }

    if (customPrivacyUrlEnabled && privacyPolicyEnabled) {
      const privacyError = validatePrivacyPolicyUrl(privacyPolicyUrl);
      if (privacyError) {
        setPrivacyPolicyUrlError(privacyError);
        toast.error("Please fix the validation errors before saving");
        return;
      }
    }

    setIsLoading(true);
    try {
      let logoBlobUrl: string | null =
        logo && logo.startsWith("data:") ? null : logo;
      if (logo && logo.startsWith("data:")) {
        const blob = convertDataUrlToFile({ dataUrl: logo });
        logoBlobUrl = await uploadImage(blob);
        setLogo(logoBlobUrl);
      }

      let bannerBlobUrl: string | null =
        banner && banner.startsWith("data:") ? null : banner;
      if (banner && banner.startsWith("data:")) {
        const blob = convertDataUrlToFile({ dataUrl: banner });
        bannerBlobUrl = await uploadImage(blob);
        setBanner(bannerBlobUrl);
      }

      // Persist Custom Link Preview assets the same way as logo/banner: when the
      // user is on a tier that can write them and has the toggle on, swap any
      // data: URL for a uploaded blob URL before sending to the API.
      let linkPreviewImageUrl: string | null = linkPreviewImage;
      if (
        hasBusinessMessagingAccess &&
        linkPreviewEnabled &&
        linkPreviewImage &&
        linkPreviewImage.startsWith("data:")
      ) {
        const blob = convertDataUrlToFile({ dataUrl: linkPreviewImage });
        linkPreviewImageUrl = await uploadImage(blob);
        setLinkPreviewImage(linkPreviewImageUrl);
      }

      let linkPreviewFaviconUrl: string | null = linkPreviewFavicon;
      if (
        hasBusinessMessagingAccess &&
        linkPreviewEnabled &&
        linkPreviewFavicon &&
        linkPreviewFavicon.startsWith("data:")
      ) {
        const blob = convertDataUrlToFile({ dataUrl: linkPreviewFavicon });
        linkPreviewFaviconUrl = await uploadImage(blob);
        setLinkPreviewFavicon(linkPreviewFaviconUrl);
      }

      const data = {
        name: brandName.trim() || "Default",
        welcomeMessage: hasBusinessMessagingAccess
          ? welcomeEnabled
            ? welcomeMessage.trim() || DEFAULT_WELCOME_MESSAGE
            : null
          : (selectedBrand?.welcomeMessage ?? null),
        brandColor: brandColor,
        accentColor: accentColor,
        accentButtonColor: accentButtonColor,
        applyAccentColorToDataroomView,
        logo: logoBlobUrl,
        hideLogo,
        ctaLabel: hasBusinessMessagingAccess
          ? ctaEnabled
            ? ctaLabel.trim() || null
            : null
          : (selectedBrand?.ctaLabel ?? null),
        ctaUrl: hasBusinessMessagingAccess
          ? ctaEnabled
            ? ctaUrl.trim() || null
            : null
          : (selectedBrand?.ctaUrl ?? null),
        ...(customPrivacyUrlEnabled && {
          privacyPolicyUrl: privacyPolicyEnabled
            ? privacyPolicyUrl.trim() || null
            : null,
        }),
        customLinkPreviewEnabled: hasBusinessMessagingAccess
          ? linkPreviewEnabled
          : !!selectedBrand?.customLinkPreviewEnabled,
        linkPreviewTitle: hasBusinessMessagingAccess
          ? linkPreviewEnabled
            ? linkPreviewTitle.trim() || null
            : null
          : (selectedBrand?.linkPreviewTitle ?? null),
        linkPreviewDescription: hasBusinessMessagingAccess
          ? linkPreviewEnabled
            ? linkPreviewDescription.trim() || null
            : null
          : (selectedBrand?.linkPreviewDescription ?? null),
        linkPreviewImage: hasBusinessMessagingAccess
          ? linkPreviewEnabled
            ? linkPreviewImageUrl
            : null
          : (selectedBrand?.linkPreviewImage ?? null),
        linkPreviewFavicon: hasBusinessMessagingAccess
          ? linkPreviewEnabled
            ? linkPreviewFaviconUrl
            : null
          : (selectedBrand?.linkPreviewFavicon ?? null),
        // Only include banner if user has dataroom access (Business+)
        ...(hasDataroomAccess && { banner: bannerBlobUrl }),
        // Layout fields are only included when the plan can persist them. The
        // API still re-checks tier and silently drops them otherwise, but
        // sending less keeps the payload honest.
        ...(hasLayoutSaveAccess && {
          cardLayout,
          showFolderTree,
          viewerHeaderStyle,
          hideFolderIconsInMain,
          viewerLayoutPreset: derivedLayoutPreset,
        }),
      };

      const teamId = teamInfo?.currentTeam?.id;
      const res = await fetch(
        persistedBrandId
          ? `/api/teams/${teamId}/brands/${persistedBrandId}`
          : isDraftBrand
            ? `/api/teams/${teamId}/brands`
            : `/api/teams/${teamId}/branding`,
        {
          method: persistedBrandId ? "PUT" : "POST",
          body: JSON.stringify(data),
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (res.ok) {
        const saved = await res.json().catch(() => null);
        if (saved?.id) {
          setSelectedBrandId(saved.id);
        }
        mutate(`/api/teams/${teamId}/branding`);
        void mutateBrands();
        if (hasLayoutSaveAccess) {
          initialLayoutSnapshotRef.current = {
            cardLayout,
            showFolderTree,
            viewerHeaderStyle,
            hideFolderIconsInMain,
          };
        }
        toast.success("Branding updated successfully");
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error("Save error:", errorData);
        toast.error(errorData.message || "Failed to save branding");
      }
    } catch (error) {
      console.error("Save branding failed:", error);
      toast.error("Failed to upload branding assets. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateBrand = () => {
    setSelectedBrandId(DRAFT_TEAM_BRAND_ID);
    applyEmptyBrandForm(nextTeamBrandName(brands));
  };

  const handleSetDefaultBrand = async () => {
    const teamId = teamInfo?.currentTeam?.id;
    if (!teamId || !persistedBrandId) return;
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/teams/${teamId}/brands/${persistedBrandId}/default`,
        { method: "POST" },
      );
      if (!res.ok) {
        toast.error("Failed to set default brand");
        return;
      }
      await mutateBrands();
      mutate(`/api/teams/${teamId}/branding`);
      toast.success("Default brand updated");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (isDraftBrand) {
      setSelectedBrandId(defaultBrandId);
      return;
    }

    setIsLoading(true);
    const teamId = teamInfo?.currentTeam?.id;
    const res = await fetch(
      persistedBrandId
        ? `/api/teams/${teamId}/brands/${persistedBrandId}`
        : `/api/teams/${teamId}/branding`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (res.ok) {
      await mutate(`/api/teams/${teamId}/branding`);
      const next = await mutateBrands();
      setSelectedBrandId(next?.defaultBrandId ?? null);
      setLogo(null);
      setHideLogo(false);
      setBanner(null);
      setBrandColor("#000000");
      setAccentColor("#030712");
      setAccentButtonColor("#000000");
      setCtaEnabled(false);
      setCtaLabel("");
      setCtaUrl("");
      setPrivacyPolicyEnabled(false);
      setPrivacyPolicyUrl("");
      setPrivacyPolicyUrlError(null);
      setApplyAccentColorToDataroomView(false);
      setWelcomeMessage(DEFAULT_WELCOME_MESSAGE);
      setWelcomeEnabled(false);
      setWelcomeMessageError(null);
      setLinkPreviewEnabled(false);
      setLinkPreviewTitle("");
      setLinkPreviewDescription("");
      setLinkPreviewImage(null);
      setLinkPreviewFavicon(null);
      setCardLayout("LIST");
      setShowFolderTree(true);
      setViewerHeaderStyle("DEFAULT");
      setHideFolderIconsInMain(false);
      initialLayoutSnapshotRef.current = {
        cardLayout: "LIST",
        showFolderTree: true,
        viewerHeaderStyle: "DEFAULT",
        hideFolderIconsInMain: false,
      };
      setIsLoading(false);
      toast.success("Brand deleted");
    } else {
      setIsLoading(false);
      toast.error("Failed to delete brand");
    }
  };

  const mainPreviewTabCount = 2 + (hasDataroomAccess ? 1 : 0);

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mb-0 lg:mt-8 lg:flex lg:h-[calc(100vh-7rem)] lg:flex-col xl:mx-10">
        <div className="mb-4 flex items-start justify-between gap-4 md:mb-6 lg:shrink-0">
          <div className="max-w-3xl space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Branding
            </h1>
            <div className="text-sm text-muted-foreground">
              The default brand applies to every document and data room link
              unless you pick another brand on that link or room.{" "}
              <BadgeTooltip
                linkText="Click here"
                content="How to customize document branding?"
                key="branding"
                link="https://www.papermark.com/help/article/document-branding"
              >
                <CircleHelpIcon className="inline-block h-4 w-4 shrink-0 align-text-bottom text-muted-foreground hover:text-foreground" />
              </BadgeTooltip>
            </div>
          </div>
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link href="/settings/domains">Custom domains</Link>
          </Button>
        </div>

        <TeamBrandSwitcher
          brands={brands}
          selectedBrandId={selectedBrandId}
          defaultBrandId={defaultBrandId}
          brandName={brandName}
          onBrandNameChange={setBrandName}
          onSelect={setSelectedBrandId}
          onCreate={handleCreateBrand}
          onSetDefault={handleSetDefaultBrand}
          onDelete={handleDelete}
          disabled={isLoading}
        />

        <div className="flex w-full flex-col gap-6 lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-8">
          {/* Settings Column */}
          <div className="flex w-full flex-col gap-6 lg:min-h-0 lg:w-[420px] lg:shrink-0">
            {/* Scrollable Settings — wrapped in Tabs (Branding / Layouts).
                The Layouts trigger only renders when the team plan grants
                visibility (Business+, DataRooms+, or any dataroom trial);
                free plans see no Layouts tab at all. */}
            <Tabs
              value={settingsTab}
              onValueChange={(v) => {
                setSettingsTab(v);
                // When opening the Layouts settings tab, lock the preview to
                // the dataroom view since that's the only surface layouts
                // affect. Switching back to Branding leaves the preview where
                // the user left it.
                if (v === "layouts") {
                  setPreviewTab("dataroom-view");
                }
              }}
              className="flex w-full flex-col lg:min-h-0 lg:flex-1"
            >
              <TabsList
                className={cn(
                  "grid w-full shrink-0",
                  hasLayoutVisibility ? "grid-cols-2" : "grid-cols-1",
                )}
              >
                <TabsTrigger value="branding">Branding</TabsTrigger>
                {hasLayoutVisibility && (
                  <TabsTrigger value="layouts" className="gap-1.5">
                    Layouts
                    <span className="inline-flex items-center rounded-[4px] bg-orange-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide text-white">
                      New
                    </span>
                  </TabsTrigger>
                )}
              </TabsList>
              <TabsContent
                value="branding"
                className="mt-4 focus-visible:outline-none lg:min-h-0 lg:flex-1"
              >
                <FadeScrollArea
                  className="lg:h-full"
                  showScrollbar
                  contentClassName="flex flex-col gap-6 lg:pr-2.5"
                >
                  {/* Auto-fill from website */}
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-3">
                        <Label htmlFor="auto-fill-url">
                          Auto-fill from website
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Paste a website URL and we&apos;ll pull logo
                          {hasDataroomAccess ? ", banner" : ""} and brand colors
                          automatically. You can still tweak everything below
                          before saving.
                        </p>
                        <div className="flex gap-2">
                          <Input
                            id="auto-fill-url"
                            type="text"
                            placeholder="company.com"
                            value={autoFillUrl}
                            onChange={(e) => setAutoFillUrl(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAutoFill();
                              }
                            }}
                          />
                          <Button
                            type="button"
                            onClick={handleAutoFill}
                            loading={autoFillLoading}
                            disabled={!autoFillUrl.trim()}
                          >
                            Fetch
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Logo Card */}
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-2">
                        <Label htmlFor="image">
                          Logo{" "}
                          <span className="font-normal text-muted-foreground">
                            (max 2 MB)
                          </span>
                        </Label>
                        <label
                          htmlFor="image"
                          className="group relative mt-2 flex h-20 w-48 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 transition-all hover:border-gray-400 hover:bg-gray-100"
                        >
                          <div
                            className="absolute z-[5] h-full w-full rounded-lg"
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDragActive(true);
                            }}
                            onDragEnter={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDragActive(true);
                            }}
                            onDragLeave={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDragActive(false);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDragActive(false);
                              setFileError(null);
                              const file =
                                e.dataTransfer.files && e.dataTransfer.files[0];
                              if (file) {
                                if (file.size / 1024 / 1024 > 2) {
                                  setFileError("File size too big (max 2MB)");
                                } else if (
                                  file.type !== "image/png" &&
                                  file.type !== "image/jpeg"
                                ) {
                                  setFileError(
                                    "File type not supported (.png or .jpg only)",
                                  );
                                } else {
                                  const reader = new FileReader();
                                  reader.onload = (e) => {
                                    const dataUrl = e.target?.result as string;
                                    setLogo(dataUrl);
                                    setHideLogo(false);
                                    const blob = convertDataUrlToFile({
                                      dataUrl,
                                    });
                                    const blobUrl = URL.createObjectURL(blob);
                                    setBlobUrl(blobUrl);
                                  };
                                  reader.readAsDataURL(file);
                                }
                              }
                            }}
                          />
                          {!logo ? (
                            <div
                              className={cn(
                                "flex flex-col items-center justify-center gap-2",
                                dragActive && "scale-105",
                              )}
                            >
                              <UploadIcon
                                className="h-8 w-8 text-gray-400"
                                aria-hidden="true"
                              />
                            </div>
                          ) : (
                            <div className="relative flex h-full w-full items-center justify-center p-4">
                              <img
                                src={logo}
                                alt="Logo preview"
                                className={cn(
                                  "max-h-full max-w-full object-contain",
                                  hideLogo && "opacity-40",
                                )}
                              />
                            </div>
                          )}
                        </label>
                        <input
                          id="image"
                          name="image"
                          type="file"
                          accept="image/jpeg,image/png"
                          className="sr-only"
                          onChange={onChangeLogo}
                        />
                        {fileError && (
                          <p className="text-sm text-red-500">{fileError}</p>
                        )}
                        <div className="rounded-md border border-border/70 p-3">
                          <div className="flex items-start space-x-3">
                            <Checkbox
                              id="global-hide-logo"
                              checked={hideLogo}
                              onCheckedChange={(checked) =>
                                setHideLogo(checked === true)
                              }
                              className="mt-0.5"
                            />
                            <div className="space-y-1">
                              <Label
                                htmlFor="global-hide-logo"
                                className="cursor-pointer text-sm font-medium"
                              >
                                Show no logo
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                Visitors see no logo at all, not even the
                                Papermark logo.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Banner Card - Only for Business+ users */}
                  {hasDataroomAccess && (
                    <Card>
                      <CardContent className="space-y-3 pt-6">
                        <BannerEditor
                          banner={banner}
                          setBanner={setBanner}
                          setBannerBlobUrl={setBannerBlobUrl}
                          sizeHint="(for data rooms, max 2 MB)"
                          onUrlApplied={() => {
                            // Pasting a banner URL (image/video/YouTube) is a
                            // strong signal the user wants a richer hero — auto
                            // promote Standard → Modern so the preview reflects
                            // it. Only run when Layouts UI is visible to this
                            // plan; otherwise we'd silently mutate state the
                            // user can't see or revert.
                            if (
                              hasLayoutVisibility &&
                              derivedLayoutPreset === "STANDARD"
                            ) {
                              applyLayoutPreset("MODERN");
                              setPreviewTab("dataroom-view");
                            }
                          }}
                          dropZone={
                            <>
                              <label
                                htmlFor="banner"
                                className="group relative flex h-32 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 transition-all hover:border-gray-400 hover:bg-gray-100"
                              >
                                <div
                                  className="absolute z-[5] h-full w-full rounded-lg"
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setBannerDragActive(true);
                                  }}
                                  onDragEnter={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setBannerDragActive(true);
                                  }}
                                  onDragLeave={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setBannerDragActive(false);
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setBannerDragActive(false);
                                    setBannerError(null);
                                    const file =
                                      e.dataTransfer.files &&
                                      e.dataTransfer.files[0];
                                    if (file) {
                                      if (file.size / 1024 / 1024 > 2) {
                                        setBannerError(
                                          "File size too big (max 2MB)",
                                        );
                                      } else if (
                                        file.type !== "image/png" &&
                                        file.type !== "image/jpeg"
                                      ) {
                                        setBannerError(
                                          "File type not supported (.png or .jpg only)",
                                        );
                                      } else {
                                        const reader = new FileReader();
                                        reader.onload = (e) => {
                                          const dataUrl = e.target
                                            ?.result as string;
                                          setBanner(dataUrl);
                                          const blob = convertDataUrlToFile({
                                            dataUrl,
                                          });
                                          const blobUrl =
                                            URL.createObjectURL(blob);
                                          setBannerBlobUrl(blobUrl);
                                        };
                                        reader.readAsDataURL(file);
                                      }
                                    }
                                  }}
                                />
                                {!banner ? (
                                  <div
                                    className={cn(
                                      "flex flex-col items-center justify-center gap-2",
                                      bannerDragActive && "scale-105",
                                    )}
                                  >
                                    <UploadIcon
                                      className="h-8 w-8 text-gray-400"
                                      aria-hidden="true"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      Upload banner image
                                    </p>
                                  </div>
                                ) : (
                                  <div className="relative h-full w-full overflow-hidden">
                                    <DataroomBannerMedia
                                      src={banner}
                                      alt="Banner preview"
                                    />
                                  </div>
                                )}
                              </label>
                              <input
                                id="banner"
                                name="banner"
                                type="file"
                                accept="image/jpeg,image/png"
                                className="sr-only"
                                onChange={onChangeBanner}
                              />
                            </>
                          }
                        />
                        {bannerError && (
                          <p className="text-sm text-red-500">{bannerError}</p>
                        )}
                        {banner && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setBanner(null);
                              setBannerBlobUrl(null);
                            }}
                            className="text-xs"
                          >
                            Remove banner
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Brand Color Card */}
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-3">
                        <Label htmlFor="primary-color">Brand Color</Label>
                        <div className="flex items-center space-x-3">
                          <Popover>
                            <PopoverTrigger>
                              <div
                                className="h-10 w-10 cursor-pointer rounded-md border-2 border-gray-300 shadow-sm transition-all hover:border-gray-400"
                                style={{ backgroundColor: brandColor }}
                              />
                            </PopoverTrigger>
                            <PopoverContent>
                              <HexColorPicker
                                color={brandColor}
                                onChange={setBrandColor}
                              />
                            </PopoverContent>
                          </Popover>
                          <HexColorInput
                            className="flex h-10 w-full rounded-md border border-gray-300 bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                            color={brandColor}
                            onChange={setBrandColor}
                            prefixed
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Background Color Card */}
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-3">
                        <Label htmlFor="accent-color">
                          Background Color{" "}
                          <span className="font-normal text-muted-foreground">
                            (front page)
                          </span>
                        </Label>
                        <div className="flex items-center space-x-3">
                          <Popover>
                            <PopoverTrigger>
                              <div
                                className="h-10 w-10 cursor-pointer rounded-md border-2 border-gray-300 shadow-sm transition-all hover:border-gray-400"
                                style={{ backgroundColor: accentColor }}
                              />
                            </PopoverTrigger>
                            <PopoverContent>
                              <HexColorPicker
                                color={accentColor}
                                onChange={setAccentColor}
                              />
                            </PopoverContent>
                          </Popover>
                          <HexColorInput
                            className="flex h-10 w-full rounded-md border border-gray-300 bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                            color={accentColor}
                            onChange={setAccentColor}
                            prefixed
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <div
                            className="relative h-10 w-10 cursor-pointer rounded-md bg-white shadow-sm ring-2 ring-gray-300 transition-all hover:ring-gray-400"
                            onClick={() => setAccentColor("#ffffff")}
                          >
                            {accentColor === "#ffffff" && (
                              <Check className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-gray-600" />
                            )}
                          </div>
                          <div
                            className="relative h-10 w-10 cursor-pointer rounded-md bg-gray-50 shadow-sm ring-2 ring-gray-300 transition-all hover:ring-gray-400"
                            onClick={() => setAccentColor("#f9fafb")}
                          >
                            {accentColor === "#f9fafb" && (
                              <Check className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-gray-600" />
                            )}
                          </div>
                          <div
                            className="relative h-10 w-10 cursor-pointer rounded-md bg-gray-200 shadow-sm ring-2 ring-gray-300 transition-all hover:ring-gray-400"
                            onClick={() => setAccentColor("#e5e7eb")}
                          >
                            {accentColor === "#e5e7eb" && (
                              <Check className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-gray-600" />
                            )}
                          </div>
                          <div
                            className="relative h-10 w-10 cursor-pointer rounded-md bg-gray-400 shadow-sm ring-2 ring-gray-300 transition-all hover:ring-gray-400"
                            onClick={() => setAccentColor("#9ca3af")}
                          >
                            {accentColor === "#9ca3af" && (
                              <Check className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-white" />
                            )}
                          </div>
                          <div
                            className="relative h-10 w-10 cursor-pointer rounded-md bg-gray-800 shadow-sm ring-2 ring-gray-300 transition-all hover:ring-gray-400"
                            onClick={() => setAccentColor("#1f2937")}
                          >
                            {accentColor === "#1f2937" && (
                              <Check className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-white" />
                            )}
                          </div>
                          <div
                            className="relative h-10 w-10 cursor-pointer rounded-md bg-gray-950 shadow-sm ring-2 ring-gray-300 transition-all hover:ring-gray-400"
                            onClick={() => setAccentColor("#030712")}
                          >
                            {accentColor === "#030712" && (
                              <Check className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-white" />
                            )}
                          </div>
                        </div>
                        {hasDataroomAccess && (
                          <div className="rounded-md border border-border/70 p-3">
                            <div className="flex items-start space-x-3">
                              <Checkbox
                                id="global-apply-accent-to-dataroom-view"
                                checked={applyAccentColorToDataroomView}
                                onCheckedChange={(checked) =>
                                  setApplyAccentColorToDataroomView(
                                    checked === true,
                                  )
                                }
                                className="mt-0.5"
                              />
                              <div className="space-y-1">
                                <Label
                                  htmlFor="global-apply-accent-to-dataroom-view"
                                  className="cursor-pointer text-sm font-medium"
                                >
                                  Apply background color to dataroom view
                                </Label>
                                {/* <p className="text-xs text-muted-foreground">
                                Dataroom-specific branding can still override
                                this.
                              </p> */}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <CollapsibleBrandingSection
                    title="Advanced settings"
                    defaultOpen={false}
                  >
                    <div className="flex flex-col gap-6">
                      {/* Call to Action Card (with toggle) */}
                      <Card>
                        <CardContent className="pt-6">
                          <div className="space-y-3">
                            <div
                              className="flex items-center justify-between"
                              onClick={
                                !hasBusinessMessagingAccess
                                  ? () => setUpgradeMessagingModalOpen(true)
                                  : undefined
                              }
                            >
                              <div
                                className={cn(
                                  "flex flex-col",
                                  !hasBusinessMessagingAccess &&
                                    "cursor-pointer",
                                )}
                              >
                                <div className="flex items-center gap-2">
                                  <Label htmlFor="cta-enabled">
                                    Call to Action
                                  </Label>
                                  {!hasBusinessMessagingAccess && (
                                    <CrownIcon
                                      className="h-3.5 w-3.5 text-muted-foreground"
                                      aria-label="Business plan feature"
                                    />
                                  )}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Add a button visitors can click to open an
                                  external link (e.g. book a meeting, visit your
                                  website).
                                </p>
                              </div>
                              <Switch
                                id="cta-enabled"
                                checked={ctaEnabled}
                                className={
                                  !hasBusinessMessagingAccess
                                    ? "cursor-pointer opacity-50"
                                    : undefined
                                }
                                onClick={
                                  !hasBusinessMessagingAccess
                                    ? (e) => {
                                        e.preventDefault();
                                        setUpgradeMessagingModalOpen(true);
                                      }
                                    : undefined
                                }
                                onCheckedChange={
                                  !hasBusinessMessagingAccess
                                    ? undefined
                                    : (checked) => {
                                        setCtaEnabled(checked);
                                        if (checked && !ctaLabel.trim()) {
                                          setCtaLabel("Book a call");
                                        }
                                      }
                                }
                              />
                            </div>
                            {ctaEnabled && (
                              <div className="space-y-3 border-t pt-4">
                                <div className="space-y-2">
                                  <Label htmlFor="cta-label">
                                    Button label
                                  </Label>
                                  <Input
                                    id="cta-label"
                                    placeholder="Book a meeting"
                                    value={ctaLabel}
                                    onChange={(e) =>
                                      setCtaLabel(e.target.value)
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="cta-url">Link</Label>
                                  <Input
                                    id="cta-url"
                                    placeholder="https://..."
                                    value={ctaUrl}
                                    onChange={(e) => setCtaUrl(e.target.value)}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="accent-button-color">
                                    Button color{" "}
                                    <span className="font-normal text-muted-foreground">
                                      (accent)
                                    </span>
                                  </Label>
                                  <div className="flex items-center space-x-3">
                                    <Popover>
                                      <PopoverTrigger>
                                        <div
                                          className="h-10 w-10 cursor-pointer rounded-md border-2 border-gray-300 shadow-sm transition-all hover:border-gray-400"
                                          style={{
                                            backgroundColor: accentButtonColor,
                                          }}
                                        />
                                      </PopoverTrigger>
                                      <PopoverContent>
                                        <HexColorPicker
                                          color={accentButtonColor}
                                          onChange={setAccentButtonColor}
                                        />
                                      </PopoverContent>
                                    </Popover>
                                    <HexColorInput
                                      className="flex h-10 w-full rounded-md border border-gray-300 bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                                      color={accentButtonColor}
                                      onChange={setAccentButtonColor}
                                      prefixed
                                    />
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Welcome Message Card (with toggle) */}
                      <Card>
                        <CardContent className="pt-6">
                          <div className="space-y-3">
                            <div
                              className="flex items-center justify-between"
                              onClick={
                                !hasBusinessMessagingAccess
                                  ? () => setUpgradeMessagingModalOpen(true)
                                  : undefined
                              }
                            >
                              <div
                                className={cn(
                                  "flex flex-col",
                                  !hasBusinessMessagingAccess &&
                                    "cursor-pointer",
                                )}
                              >
                                <div className="flex items-center gap-2">
                                  <Label htmlFor="welcome-enabled">
                                    Welcome Message{" "}
                                    <span className="font-normal text-muted-foreground">
                                      (front page)
                                    </span>
                                  </Label>
                                  {!hasBusinessMessagingAccess && (
                                    <CrownIcon
                                      className="h-3.5 w-3.5 text-muted-foreground"
                                      aria-label="Business plan feature"
                                    />
                                  )}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Shown to visitors on the access screen before
                                  they see your content.
                                </p>
                              </div>
                              <Switch
                                id="welcome-enabled"
                                checked={welcomeEnabled}
                                className={
                                  !hasBusinessMessagingAccess
                                    ? "cursor-pointer opacity-50"
                                    : undefined
                                }
                                onClick={
                                  !hasBusinessMessagingAccess
                                    ? (e) => {
                                        e.preventDefault();
                                        setUpgradeMessagingModalOpen(true);
                                      }
                                    : undefined
                                }
                                onCheckedChange={
                                  !hasBusinessMessagingAccess
                                    ? undefined
                                    : (checked) => {
                                        setWelcomeEnabled(checked);
                                        if (checked) {
                                          setPreviewTab("front-page");
                                        }
                                      }
                                }
                              />
                            </div>
                            {welcomeEnabled && (
                              <div className="space-y-3 border-t pt-4">
                                <div className="flex items-center justify-between">
                                  <Label
                                    htmlFor="welcome-message"
                                    className="text-sm font-medium"
                                  >
                                    Message
                                  </Label>
                                  <span className="text-sm text-muted-foreground">
                                    <span
                                      className={cn(
                                        welcomeMessageError && "text-red-500",
                                      )}
                                    >
                                      {welcomeMessage.length}
                                    </span>
                                    /{MAX_WELCOME_MESSAGE_LENGTH}
                                  </span>
                                </div>
                                <Textarea
                                  id="welcome-message"
                                  value={welcomeMessage}
                                  onChange={(e) =>
                                    handleWelcomeMessageChange(e.target.value)
                                  }
                                  placeholder={DEFAULT_WELCOME_MESSAGE}
                                  className={cn(
                                    "min-h-24 resize-none",
                                    welcomeMessageError &&
                                      "border-red-500 focus:border-red-500 focus:ring-red-500",
                                  )}
                                />
                                {welcomeMessageError && (
                                  <p className="text-xs text-red-500">
                                    {welcomeMessageError}
                                  </p>
                                )}
                                <p className="text-xs text-muted-foreground">
                                  Keep the message concise — it should fit
                                  within two lines for the best user experience.
                                </p>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Custom Link Preview — Open Graph defaults shared by
                        every data room and link the team creates. Per-link
                        and per-dataroom Custom Link Preview always override
                        this when enabled there. */}
                      <Card>
                        <CardContent className="pt-6">
                          {hasBusinessMessagingAccess ? (
                            <BrandingLinkPreviewForm
                              enabled={linkPreviewEnabled}
                              onEnabledChange={setLinkPreviewEnabled}
                              title={linkPreviewTitle}
                              onTitleChange={setLinkPreviewTitle}
                              description={linkPreviewDescription}
                              onDescriptionChange={setLinkPreviewDescription}
                              imageUrl={linkPreviewImage}
                              onImageChange={setLinkPreviewImage}
                              faviconUrl={linkPreviewFavicon}
                              onFaviconChange={setLinkPreviewFavicon}
                              inheritanceHint="Acts as the default for every data room and link. Per-dataroom and per-link previews still override this when enabled."
                            />
                          ) : (
                            <div
                              className="flex cursor-pointer items-center justify-between"
                              onClick={() => setUpgradeMessagingModalOpen(true)}
                            >
                              <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                  <Label htmlFor="link-preview-enabled-locked">
                                    Custom Link Preview
                                  </Label>
                                  <CrownIcon
                                    className="h-3.5 w-3.5 text-muted-foreground"
                                    aria-label="Business plan feature"
                                  />
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Default Open Graph title, description and
                                  image for every link and data room — per-link
                                  settings still override this.
                                </p>
                              </div>
                              <Switch
                                id="link-preview-enabled-locked"
                                checked={false}
                                className="cursor-pointer opacity-50"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setUpgradeMessagingModalOpen(true);
                                }}
                                onCheckedChange={undefined}
                              />
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      {customPrivacyUrlEnabled && (
                        <Card>
                          <CardContent className="pt-6">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                  <Label htmlFor="privacy-policy-enabled">
                                    Custom Privacy Policy
                                  </Label>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Link visitors to your own privacy policy at
                                    the bottom of the access screen instead of
                                    Papermark&apos;s.
                                  </p>
                                </div>
                                <Switch
                                  id="privacy-policy-enabled"
                                  checked={privacyPolicyEnabled}
                                  onCheckedChange={(checked) => {
                                    setPrivacyPolicyEnabled(checked);
                                    if (!checked) {
                                      setPrivacyPolicyUrlError(null);
                                    }
                                  }}
                                />
                              </div>
                              {privacyPolicyEnabled && (
                                <div className="space-y-2 border-t pt-4">
                                  <Label htmlFor="privacy-policy-url">
                                    Privacy policy URL
                                  </Label>
                                  <Input
                                    id="privacy-policy-url"
                                    placeholder="https://example.com/privacy"
                                    value={privacyPolicyUrl}
                                    onChange={(e) =>
                                      handlePrivacyPolicyUrlChange(
                                        e.target.value,
                                      )
                                    }
                                    className={cn(
                                      privacyPolicyUrlError &&
                                        "border-red-500 focus:border-red-500 focus:ring-red-500",
                                    )}
                                  />
                                  {privacyPolicyUrlError && (
                                    <p className="text-xs text-red-500">
                                      {privacyPolicyUrlError}
                                    </p>
                                  )}
                                  <p className="text-xs text-muted-foreground">
                                    Only applies to links shared on a{" "}
                                    <Link
                                      href="/settings/domains"
                                      className="underline underline-offset-4"
                                    >
                                      custom domain
                                    </Link>
                                    . Links on papermark.com keep the default
                                    privacy policy.
                                  </p>
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </CollapsibleBrandingSection>
                </FadeScrollArea>
              </TabsContent>

              {hasLayoutVisibility && (
                <TabsContent
                  value="layouts"
                  className="mt-4 focus-visible:outline-none lg:min-h-0 lg:flex-1"
                >
                  <FadeScrollArea
                    className="lg:h-full"
                    showScrollbar
                    contentClassName="flex flex-col gap-6 lg:pr-2.5"
                  >
                    <Card>
                      <CardContent className="min-w-0 space-y-3 pt-6">
                        <div>
                          <Label>Default Data Room layout</Label>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Choose a preset — applied to every dataroom that
                            hasn&apos;t set its own branding. Per-dataroom
                            branding always overrides this.
                          </p>
                        </div>
                        <DataroomLayoutPresetCards
                          selectedPreset={derivedLayoutPreset}
                          onSelect={applyLayoutPreset}
                        />
                        {derivedLayoutPreset === "CUSTOM" ? (
                          <p className="text-xs text-muted-foreground">
                            Custom combination — select a preset card to snap
                            back to a named layout.
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>

                    {/* Folder tree (left navigation) */}
                    <Card>
                      <CardContent className="pt-6">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="global-show-folder-tree">
                              Navigation tree
                            </Label>
                            <Switch
                              id="global-show-folder-tree"
                              checked={showFolderTree}
                              onCheckedChange={setShowFolderTree}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Show the folder tree in the left column. When off,
                            visitors use breadcrumbs and the main area only.
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Card Layout */}
                    <Card>
                      <CardContent className="pt-6">
                        <div className="space-y-3">
                          <Label>Document Card Layout</Label>
                          <RadioGroup
                            value={cardLayout}
                            onValueChange={(v) =>
                              setCardLayout(v as DataroomCardLayout)
                            }
                            className="grid grid-cols-3 gap-2"
                          >
                            {CARD_LAYOUT_OPTIONS.map((opt) => (
                              <Label
                                key={opt.value}
                                htmlFor={`global-card-layout-${opt.value}`}
                                className={cn(
                                  "flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs",
                                  cardLayout === opt.value &&
                                    "border-black bg-gray-50",
                                )}
                              >
                                <RadioGroupItem
                                  value={opt.value}
                                  id={`global-card-layout-${opt.value}`}
                                />
                                {opt.label}
                              </Label>
                            ))}
                          </RadioGroup>
                        </div>
                      </CardContent>
                    </Card>
                  </FadeScrollArea>
                </TabsContent>
              )}
            </Tabs>

            {/* Action Buttons - Always Visible */}
            <div className="flex items-center gap-4 border-t bg-background pt-4 lg:sticky lg:bottom-0 lg:z-10 lg:shrink-0 lg:pb-2">
              {plan === "free" && !isTrial ? (
                <UpgradeButton
                  text="Save changes"
                  clickedPlan={PlanEnum.Pro}
                  trigger="branding_page"
                  highlightItem={["custom-branding", "custom-branding-bundle"]}
                />
              ) : layoutBlocksSave ? (
                <UpgradeButton
                  text="Save changes"
                  clickedPlan={PlanEnum.DataRooms}
                  trigger="global_branding_layouts_save"
                  highlightItem={["dataroom-viewer-layouts"]}
                  hideItems={["datarooms"]}
                />
              ) : (
                <Button
                  onClick={saveBranding}
                  loading={isLoading}
                  disabled={
                    (hasBusinessMessagingAccess && !!welcomeMessageError) ||
                    (customPrivacyUrlEnabled &&
                      privacyPolicyEnabled &&
                      !!privacyPolicyUrlError)
                  }
                  className="bg-black text-white hover:bg-gray-800"
                >
                  Save changes
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={handleDelete}
                disabled={!selectedBrand && !isDraftBrand}
              >
                Reset branding
              </Button>
            </div>
            <UpgradePlanModal
              clickedPlan={PlanEnum.DataRooms}
              trigger="global_branding_layouts_save"
              highlightItem={["dataroom-viewer-layouts"]}
              hideItems={["datarooms"]}
              open={upgradeLayoutsModalOpen}
              setOpen={setUpgradeLayoutsModalOpen}
            />
            <UpgradePlanModal
              clickedPlan={PlanEnum.Business}
              trigger="global_branding_messaging_save"
              highlightItem={[
                "custom-welcome-message",
                "custom-cta",
                "custom-social-cards",
                "custom-domain",
              ]}
              open={upgradeMessagingModalOpen}
              setOpen={setUpgradeMessagingModalOpen}
            />
          </div>

          {/* Separator Line */}
          <div className="hidden lg:block lg:w-px lg:self-stretch lg:bg-border"></div>

          {/* Preview Column */}
          <div className="flex-1 lg:flex lg:min-h-0 lg:flex-col lg:pl-4">
            <Tabs
              value={previewTab}
              onValueChange={setPreviewTab}
              className="w-full lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
            >
              <div className="w-full overflow-x-auto lg:shrink-0">
                <TabsList
                  className={cn(
                    "grid w-full gap-1",
                    mainPreviewTabCount === 3 && "grid-cols-1 sm:grid-cols-3",
                    mainPreviewTabCount === 2 && "grid-cols-2",
                  )}
                >
                  <TabsTrigger value="document-view">Document View</TabsTrigger>
                  {hasDataroomAccess && (
                    <TabsTrigger value="dataroom-view">
                      Dataroom View
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="front-page">Front Page</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent
                value="document-view"
                className="mt-6 lg:mt-4 lg:min-h-0 lg:flex-1"
              >
                <BrandingPreviewChrome
                  name="document-view"
                  basePath="/nav_ppreview_demo"
                  urlLabel="papermark.com/view/..."
                  params={{
                    brandColor: debouncedBrandColor,
                    accentColor: debouncedAccentColor,
                    brandLogo: blobUrl || logo || "",
                    hideLogo: hideLogo ? "1" : "0",
                    accentButtonColor: debouncedAccentButtonColor,
                    ctaLabel: previewCtaLabel,
                    ctaUrl: previewCtaUrl,
                  }}
                />
              </TabsContent>
              {hasDataroomAccess && (
                <TabsContent
                  value="dataroom-view"
                  className="mt-6 lg:mt-4 lg:min-h-0 lg:flex-1"
                >
                  <BrandingPreviewChrome
                    name="dataroom-view"
                    basePath="/room_ppreview_demo"
                    urlLabel="papermark.com/dataroom/..."
                    params={{
                      brandColor: debouncedBrandColor,
                      accentColor: debouncedAccentColor,
                      applyAccentColorToDataroomView:
                        applyAccentColorToDataroomView ? "1" : "0",
                      brandLogo: blobUrl || logo || "",
                      hideLogo: hideLogo ? "1" : "0",
                      brandBanner:
                        banner === "no-banner"
                          ? "no-banner"
                          : bannerBlobUrl || banner || "",
                      accentButtonColor: debouncedAccentButtonColor,
                      ctaLabel: previewCtaLabel,
                      ctaUrl: previewCtaUrl,
                      cardLayout,
                      showFolderTree: showFolderTree ? "1" : "0",
                      viewerHeaderStyle,
                      hideFolderIconsInMain: hideFolderIconsInMain ? "1" : "0",
                    }}
                  />
                </TabsContent>
              )}
              <TabsContent
                value="front-page"
                className="mt-6 lg:mt-4 lg:min-h-0 lg:flex-1"
              >
                <BrandingPreviewChrome
                  name="access-screen"
                  basePath="/entrance_ppreview_demo"
                  urlLabel="papermark.com/view/..."
                  params={{
                    brandColor: debouncedBrandColor,
                    accentColor: debouncedAccentColor,
                    brandLogo: blobUrl || logo || "",
                    welcomeMessage: previewWelcomeMessage,
                  }}
                />
              </TabsContent>
            </Tabs>

            {/* Preview Mode Info */}
            {/* <div className="mt-6 flex justify-center">
                <div className="w-full max-w-[698px] space-y-2 rounded-lg border-border bg-card p-4">
                  <h4 className="text-sm font-semibold text-foreground">
                    Preview Mode
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Changes will be reflected in real-time as you adjust
                    settings.
                  </p>
                </div>
              </div> */}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
