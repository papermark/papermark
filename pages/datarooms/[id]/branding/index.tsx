import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import { BannerEditor } from "@/ee/features/branding/components/banner-editor";
import { BrandingLinkPreviewForm } from "@/ee/features/branding/components/branding-link-preview-form";
import { BrandingPreviewChrome } from "@/ee/features/branding/components/branding-preview-chrome";
import { BrandingSocialPreviewReadonly } from "@/ee/features/branding/components/branding-social-preview-readonly";
import { CollapsibleBrandingSection } from "@/ee/features/branding/components/collapsible-branding-section";
import { DataroomLayoutPresetCards } from "@/ee/features/branding/components/dataroom-layout-preset-cards";
import { VisitorLanguageCard } from "@/ee/features/branding/components/visitor-language-card";
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
import {
  CUSTOM_DATAROOM_BRAND,
  CUSTOM_DATAROOM_BRAND_LABEL,
} from "@/ee/features/branding/lib/resolve-dataroom-displayed-brand";
import { PlanEnum } from "@/ee/stripe/constants";
import { Check, CircleHelpIcon, CrownIcon, UploadIcon } from "lucide-react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import sanitizeHtml from "sanitize-html";
import { toast } from "sonner";
import { mutate } from "swr";
import { useDebounce } from "use-debounce";

import {
  DEFAULT_LOCALE,
  type SupportedLocaleCode,
  asSupportedLocale,
} from "@/lib/i18n/locales";
import { usePlan } from "@/lib/swr/use-billing";
import { useBrands, useDataroomBrand } from "@/lib/swr/use-brand";
import { useDataroom } from "@/lib/swr/use-dataroom";
import { cn, convertDataUrlToFile, uploadImage } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import AppLayout from "@/components/layouts/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FadeScrollArea } from "@/components/ui/fade-scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { BadgeTooltip } from "@/components/ui/tooltip";
import { UpgradeButton } from "@/components/ui/upgrade-button";
import { DataroomBannerMedia } from "@/components/view/dataroom/dataroom-banner-media";

const DEFAULT_BANNER_IMAGE = "/_static/papermark-banner.png";

type BrandEditorSnapshot = {
  brandColor: string;
  accentColor: string;
  accentButtonColor: string;
  applyAccentColorToDataroomView: boolean;
  logo: string | null;
  hideLogo: boolean;
  banner: string | null;
  welcomeMessage: string;
  welcomeEnabled: boolean;
  cardLayout: DataroomCardLayout;
  showFolderTree: boolean;
  viewerHeaderStyle: DataroomViewerHeaderStyle;
  hideFolderIconsInMain: boolean;
  ctaLabel: string;
  ctaUrl: string;
  ctaEnabled: boolean;
  linkPreviewEnabled: boolean;
  linkPreviewTitle: string;
  linkPreviewDescription: string;
  linkPreviewImage: string | null;
  linkPreviewFavicon: string | null;
  defaultLanguage: SupportedLocaleCode;
};

function brandEditorSnapshotsEqual(
  left: BrandEditorSnapshot,
  right: BrandEditorSnapshot,
) {
  return (
    left.brandColor === right.brandColor &&
    left.accentColor === right.accentColor &&
    left.accentButtonColor === right.accentButtonColor &&
    left.applyAccentColorToDataroomView ===
      right.applyAccentColorToDataroomView &&
    left.logo === right.logo &&
    left.hideLogo === right.hideLogo &&
    left.banner === right.banner &&
    left.welcomeMessage === right.welcomeMessage &&
    left.welcomeEnabled === right.welcomeEnabled &&
    left.cardLayout === right.cardLayout &&
    left.showFolderTree === right.showFolderTree &&
    left.viewerHeaderStyle === right.viewerHeaderStyle &&
    left.hideFolderIconsInMain === right.hideFolderIconsInMain &&
    left.ctaLabel === right.ctaLabel &&
    left.ctaUrl === right.ctaUrl &&
    left.ctaEnabled === right.ctaEnabled &&
    left.linkPreviewEnabled === right.linkPreviewEnabled &&
    left.linkPreviewTitle === right.linkPreviewTitle &&
    left.linkPreviewDescription === right.linkPreviewDescription &&
    left.linkPreviewImage === right.linkPreviewImage &&
    left.linkPreviewFavicon === right.linkPreviewFavicon &&
    left.defaultLanguage === right.defaultLanguage
  );
}

export default function DataroomBrandPage() {
  const teamInfo = useTeam();
  const { isDatarooms, isDataroomsPlus, isTrial, isBusiness } = usePlan();
  const hasLayoutCustomizationAccess =
    isDatarooms || isDataroomsPlus || isTrial;
  const hasBusinessMessagingAccess = isBusiness || isDatarooms || isTrial;
  const hasVisitorLanguageAccess = isDataroomsPlus || isTrial;
  const { dataroom } = useDataroom();
  const { brand: dataroomBrand } = useDataroomBrand({
    dataroomId: dataroom?.id,
  });
  const { brands, defaultBrandId } = useBrands();
  const isCustomBrand = !dataroom?.brandId;
  const selectedTeamBrand = useMemo(
    () => brands.find((item) => item.id === dataroom?.brandId) ?? null,
    [brands, dataroom?.brandId],
  );

  const [brandColor, setBrandColor] = useState<string>("#000000");
  const [accentColor, setAccentColor] = useState<string>("#FFFFFF");
  const [accentButtonColor, setAccentButtonColor] = useState<string>("#000000");
  const [applyAccentColorToDataroomView, setApplyAccentColorToDataroomView] =
    useState<boolean>(false);
  const [logo, setLogo] = useState<string | null>(null);
  const [hideLogoOverride, setHideLogoOverride] = useState<boolean | null>(
    false,
  );
  const [banner, setBanner] = useState<string | null>(null);
  const [originalBanner, setOriginalBanner] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [bannerBlobUrl, setBannerBlobUrl] = useState<string | null>(null);
  const DEFAULT_WELCOME_MESSAGE = "Your action is requested to continue";
  const [welcomeMessage, setWelcomeMessage] = useState<string>(
    DEFAULT_WELCOME_MESSAGE,
  );
  const [welcomeEnabled, setWelcomeEnabled] = useState<boolean>(false);
  const [linkPreviewEnabled, setLinkPreviewEnabled] = useState(false);
  const [linkPreviewTitle, setLinkPreviewTitle] = useState("");
  const [linkPreviewDescription, setLinkPreviewDescription] = useState("");
  const [linkPreviewImage, setLinkPreviewImage] = useState<string | null>(null);
  const [linkPreviewFavicon, setLinkPreviewFavicon] = useState<string | null>(
    null,
  );
  const [previewTab, setPreviewTab] = useState<string>("dataroom-view");
  const hideLogo = Boolean(hideLogoOverride);

  // Layout customization state
  const [showFolderTree, setShowFolderTree] = useState<boolean>(true);
  const [cardLayout, setCardLayout] = useState<DataroomCardLayout>("LIST");
  const [viewerHeaderStyle, setViewerHeaderStyle] =
    useState<DataroomViewerHeaderStyle>("DEFAULT");
  const [hideFolderIconsInMain, setHideFolderIconsInMain] =
    useState<boolean>(false);
  const [ctaLabel, setCtaLabel] = useState<string>("");
  const [ctaUrl, setCtaUrl] = useState<string>("");

  // Visitor i18n: a single language the admin picks; visitors never switch.
  const [defaultLanguage, setDefaultLanguage] =
    useState<SupportedLocaleCode>(DEFAULT_LOCALE);
  const [debouncedBrandColor] = useDebounce(brandColor, 300);
  const [debouncedAccentColor] = useDebounce(accentColor, 300);
  const [debouncedWelcomeMessage] = useDebounce(welcomeMessage, 500);
  const [debouncedLinkPreviewTitle] = useDebounce(linkPreviewTitle, 300);
  const [debouncedLinkPreviewDescription] = useDebounce(
    linkPreviewDescription,
    300,
  );
  const [debouncedLinkPreviewImage] = useDebounce(linkPreviewImage, 300);
  const [debouncedLinkPreviewFavicon] = useDebounce(linkPreviewFavicon, 300);
  const previewWelcomeMessage =
    hasBusinessMessagingAccess && welcomeEnabled
      ? debouncedWelcomeMessage
      : DEFAULT_WELCOME_MESSAGE;
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [welcomeMessageError, setWelcomeMessageError] = useState<string | null>(
    null,
  );

  // Auto-fill from website (brand lookup)
  const [autoFillUrl, setAutoFillUrl] = useState<string>("");
  const [autoFillLoading, setAutoFillLoading] = useState<boolean>(false);
  const [ctaEnabled, setCtaEnabled] = useState<boolean>(false);

  const lastVisibleBannerRef = useRef<string | null>(null);

  // Snapshot of layout fields at last load, used to detect "unsaved layout changes"
  // for the upgrade gate when the team is below the Data Rooms tier.
  const initialLayoutSnapshotRef = useRef<{
    cardLayout: DataroomCardLayout;
    showFolderTree: boolean;
    viewerHeaderStyle: DataroomViewerHeaderStyle;
    hideFolderIconsInMain: boolean;
  } | null>(null);

  const initialLanguageRef = useRef<SupportedLocaleCode | null>(null);
  const sourceBrandSnapshotRef = useRef<BrandEditorSnapshot | null>(null);

  const [upgradeLayoutsModalOpen, setUpgradeLayoutsModalOpen] =
    useState<boolean>(false);
  const [upgradeMessagingModalOpen, setUpgradeMessagingModalOpen] =
    useState<boolean>(false);

  useEffect(() => {
    if (banner && banner !== "no-banner") {
      lastVisibleBannerRef.current = banner;
    }
  }, [banner]);

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

  const layoutBlocksSave =
    !hasLayoutCustomizationAccess && layoutHasUnsavedChanges;

  const languageHasUnsavedChanges =
    initialLanguageRef.current !== null &&
    initialLanguageRef.current !== defaultLanguage;

  // English is the default locale and always free — only block when the
  // user lands on a non-default language without an eligible plan.
  const languageBlocksSave =
    !hasVisitorLanguageAccess &&
    languageHasUnsavedChanges &&
    defaultLanguage !== DEFAULT_LOCALE;

  const blocksSave = layoutBlocksSave || languageBlocksSave;

  const applyLayoutPreset = (id: DataroomLayoutCardId) => {
    const restoreBanner = () =>
      lastVisibleBannerRef.current ??
      (originalBanner && originalBanner !== "no-banner"
        ? originalBanner
        : null) ??
      DEFAULT_BANNER_IMAGE;

    switch (id) {
      case "STANDARD":
        setBanner(restoreBanner());
        setCardLayout("LIST");
        setShowFolderTree(true);
        setViewerHeaderStyle("DEFAULT");
        setHideFolderIconsInMain(false);
        break;
      case "STRICT":
        if (banner !== "no-banner") {
          lastVisibleBannerRef.current = banner;
        }
        setBanner("no-banner");
        setCardLayout("COMPACT");
        setShowFolderTree(false);
        setViewerHeaderStyle("DEFAULT");
        setHideFolderIconsInMain(true);
        break;
      case "MODERN":
        setBanner(restoreBanner());
        setCardLayout("COMPACT");
        setShowFolderTree(false);
        setViewerHeaderStyle("SPLIT");
        setHideFolderIconsInMain(true);
        break;
      case "NOTION":
        setBanner(restoreBanner());
        setCardLayout("GRID");
        setShowFolderTree(false);
        setViewerHeaderStyle("NOTION");
        setHideFolderIconsInMain(false);
        break;
      default:
        break;
    }
  };

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
      if (!autoFillHasBrandAssets(data, { allowBanner: true })) {
        toast.error(AUTO_FILL_NOT_FOUND_MESSAGE);
        return;
      }
      if (data.logo) {
        setLogo(data.logo);
        setBlobUrl(null);
      }
      if (data.banner) {
        setBanner(data.banner);
        setOriginalBanner(data.banner);
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
            setHideLogoOverride(false);
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
      setFileError(null);
      const file = e.target.files[0];
      if (file) {
        if (file.size / 1024 / 1024 > 5) {
          setFileError("File size too big (max 5MB)");
        } else if (file.type !== "image/png" && file.type !== "image/jpeg") {
          setFileError("File type not supported (.png or .jpg only)");
        } else {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            setBanner(dataUrl);
            // When uploading a new image, this becomes the new "original" until saved
            setOriginalBanner(dataUrl);
            // create a blob url for preview
            const blob = convertDataUrlToFile({ dataUrl });
            const bannerBlobUrl = URL.createObjectURL(blob);
            setBannerBlobUrl(bannerBlobUrl);
          };
          reader.readAsDataURL(file);
        }
      }
    },
    [setBanner],
  );

  const applyEmptyCustomBrand = () => {
    setBrandColor("#000000");
    setAccentColor("#FFFFFF");
    setAccentButtonColor("#000000");
    setApplyAccentColorToDataroomView(false);
    setLogo(null);
    setHideLogoOverride(false);
    setBanner(DEFAULT_BANNER_IMAGE);
    setOriginalBanner(DEFAULT_BANNER_IMAGE);
    setWelcomeMessage(DEFAULT_WELCOME_MESSAGE);
    setWelcomeEnabled(false);
    setWelcomeMessageError(null);
    setShowFolderTree(true);
    setCardLayout("LIST");
    setViewerHeaderStyle("DEFAULT");
    setHideFolderIconsInMain(false);
    initialLayoutSnapshotRef.current = {
      cardLayout: "LIST",
      showFolderTree: true,
      viewerHeaderStyle: "DEFAULT",
      hideFolderIconsInMain: false,
    };
    setCtaLabel("");
    setCtaUrl("");
    setCtaEnabled(false);
    setLinkPreviewEnabled(false);
    setLinkPreviewTitle("");
    setLinkPreviewDescription("");
    setLinkPreviewImage(null);
    setLinkPreviewFavicon(null);
    setDefaultLanguage(DEFAULT_LOCALE);
    initialLanguageRef.current = DEFAULT_LOCALE;
    sourceBrandSnapshotRef.current = {
      brandColor: "#000000",
      accentColor: "#FFFFFF",
      accentButtonColor: "#000000",
      applyAccentColorToDataroomView: false,
      logo: null,
      hideLogo: false,
      banner: DEFAULT_BANNER_IMAGE,
      welcomeMessage: DEFAULT_WELCOME_MESSAGE,
      welcomeEnabled: false,
      cardLayout: "LIST",
      showFolderTree: true,
      viewerHeaderStyle: "DEFAULT",
      hideFolderIconsInMain: false,
      ctaLabel: "",
      ctaUrl: "",
      ctaEnabled: false,
      linkPreviewEnabled: false,
      linkPreviewTitle: "",
      linkPreviewDescription: "",
      linkPreviewImage: null,
      linkPreviewFavicon: null,
      defaultLanguage: DEFAULT_LOCALE,
    };
  };

  const applySourceBrand = (source: {
    logo?: string | null;
    hideLogo?: boolean | null;
    banner?: string | null;
    brandColor?: string | null;
    accentColor?: string | null;
    accentButtonColor?: string | null;
    applyAccentColorToDataroomView?: boolean | null;
    welcomeMessage?: string | null;
    cardLayout?: string | null;
    showFolderTree?: boolean | null;
    viewerHeaderStyle?: string | null;
    hideFolderIconsInMain?: boolean | null;
    ctaLabel?: string | null;
    ctaUrl?: string | null;
    customLinkPreviewEnabled?: boolean | null;
    linkPreviewTitle?: string | null;
    linkPreviewDescription?: string | null;
    linkPreviewImage?: string | null;
    linkPreviewFavicon?: string | null;
    defaultLanguage?: string | null;
  }) => {
    setBrandColor(source.brandColor || "#000000");
    setAccentColor(source.accentColor || "#FFFFFF");
    setAccentButtonColor(
      source.accentButtonColor || source.brandColor || "#000000",
    );
    setApplyAccentColorToDataroomView(
      source.applyAccentColorToDataroomView ?? false,
    );
    setLogo(source.logo || null);
    setHideLogoOverride(source.hideLogo ?? false);
    const bannerValue = source.banner || DEFAULT_BANNER_IMAGE;
    setBanner(bannerValue);
    setOriginalBanner(bannerValue);
    const savedMessage = source.welcomeMessage ?? null;
    const message = savedMessage || DEFAULT_WELCOME_MESSAGE;
    setWelcomeMessage(message);
    setWelcomeEnabled(
      !!savedMessage && savedMessage !== DEFAULT_WELCOME_MESSAGE,
    );
    setWelcomeMessageError(validateWelcomeMessage(message));
    const nextCardLayout = asDataroomCardLayout(source.cardLayout);
    const nextShowFolderTree = source.showFolderTree ?? true;
    const nextViewerHeaderStyle = asDataroomViewerHeaderStyle(
      source.viewerHeaderStyle,
    );
    const nextHideFolderIconsInMain = Boolean(source.hideFolderIconsInMain);
    setShowFolderTree(nextShowFolderTree);
    setCardLayout(nextCardLayout);
    setViewerHeaderStyle(nextViewerHeaderStyle);
    setHideFolderIconsInMain(nextHideFolderIconsInMain);
    initialLayoutSnapshotRef.current = {
      cardLayout: nextCardLayout,
      showFolderTree: nextShowFolderTree,
      viewerHeaderStyle: nextViewerHeaderStyle,
      hideFolderIconsInMain: nextHideFolderIconsInMain,
    };
    const nextCtaLabel = source.ctaLabel ?? "";
    const nextCtaUrl = source.ctaUrl ?? "";
    setCtaLabel(nextCtaLabel);
    setCtaUrl(nextCtaUrl);
    setCtaEnabled(!!(nextCtaLabel || nextCtaUrl));
    setLinkPreviewEnabled(source.customLinkPreviewEnabled === true);
    setLinkPreviewTitle(source.linkPreviewTitle ?? "");
    setLinkPreviewDescription(source.linkPreviewDescription ?? "");
    setLinkPreviewImage(source.linkPreviewImage ?? null);
    setLinkPreviewFavicon(source.linkPreviewFavicon ?? null);
    const nextLanguage =
      asSupportedLocale(source.defaultLanguage) ?? DEFAULT_LOCALE;
    setDefaultLanguage(nextLanguage);
    initialLanguageRef.current = nextLanguage;
    sourceBrandSnapshotRef.current = {
      brandColor: source.brandColor || "#000000",
      accentColor: source.accentColor || "#FFFFFF",
      accentButtonColor:
        source.accentButtonColor || source.brandColor || "#000000",
      applyAccentColorToDataroomView:
        source.applyAccentColorToDataroomView ?? false,
      logo: source.logo || null,
      hideLogo: source.hideLogo ?? false,
      banner: source.banner || DEFAULT_BANNER_IMAGE,
      welcomeMessage: message,
      welcomeEnabled:
        !!savedMessage && savedMessage !== DEFAULT_WELCOME_MESSAGE,
      cardLayout: nextCardLayout,
      showFolderTree: nextShowFolderTree,
      viewerHeaderStyle: nextViewerHeaderStyle,
      hideFolderIconsInMain: nextHideFolderIconsInMain,
      ctaLabel: nextCtaLabel,
      ctaUrl: nextCtaUrl,
      ctaEnabled: !!(nextCtaLabel || nextCtaUrl),
      linkPreviewEnabled: source.customLinkPreviewEnabled === true,
      linkPreviewTitle: source.linkPreviewTitle ?? "",
      linkPreviewDescription: source.linkPreviewDescription ?? "",
      linkPreviewImage: source.linkPreviewImage ?? null,
      linkPreviewFavicon: source.linkPreviewFavicon ?? null,
      defaultLanguage: nextLanguage,
    };
  };

  const brandSourceKey = isCustomBrand
    ? dataroomBrand === undefined
      ? null
      : (dataroomBrand?.id ?? "empty")
    : (selectedTeamBrand?.id ?? null);

  // Re-apply only when the selected brand identity changes so SWR refreshes
  // of the same brand do not wipe in-progress edits.
  useEffect(() => {
    if (!brandSourceKey) return;
    if (isCustomBrand) {
      if (dataroomBrand) {
        applySourceBrand(dataroomBrand);
        return;
      }
      applyEmptyCustomBrand();
      return;
    }

    if (!selectedTeamBrand) return;
    applySourceBrand(selectedTeamBrand);
  }, [brandSourceKey]);

  const inheritedSnapshot = sourceBrandSnapshotRef.current;
  const hasInheritedEdits =
    !isCustomBrand &&
    inheritedSnapshot !== null &&
    !brandEditorSnapshotsEqual(inheritedSnapshot, {
      brandColor,
      accentColor,
      accentButtonColor,
      applyAccentColorToDataroomView,
      logo,
      hideLogo,
      banner,
      welcomeMessage,
      welcomeEnabled,
      cardLayout,
      showFolderTree,
      viewerHeaderStyle,
      hideFolderIconsInMain,
      ctaLabel,
      ctaUrl,
      ctaEnabled,
      linkPreviewEnabled,
      linkPreviewTitle,
      linkPreviewDescription,
      linkPreviewImage,
      linkPreviewFavicon,
      defaultLanguage,
    });
  const canSaveBranding = isCustomBrand || hasInheritedEdits;

  useEffect(() => {
    if (!linkPreviewEnabled && previewTab === "shared-link-preview") {
      setPreviewTab("dataroom-view");
    }
  }, [linkPreviewEnabled, previewTab]);

  // Handle welcome message change with validation
  const handleWelcomeMessageChange = (value: string) => {
    setWelcomeMessage(value);
    const error = validateWelcomeMessage(value);
    setWelcomeMessageError(error);
  };

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  const saveBranding = async (e: any) => {
    e.preventDefault();

    if (!canSaveBranding) {
      return;
    }

    // Block save and prompt for upgrade if the user changed any layout or
    // language settings without an eligible plan. Branding-only changes
    // (colors, banner, logo) still flow through.
    if (blocksSave) {
      setUpgradeLayoutsModalOpen(true);
      return;
    }

    // Validate welcome message before saving
    if (hasBusinessMessagingAccess) {
      const welcomeError = validateWelcomeMessage(welcomeMessage);
      if (welcomeError) {
        setWelcomeMessageError(welcomeError);
        toast.error("Please fix the validation errors before saving");
        return;
      }
    }

    setIsLoading(true);

    try {
      // Upload the image if it's a data URL
      let blobUrl: string | null = logo && logo.startsWith("data:") ? null : logo;
      if (logo && logo.startsWith("data:")) {
        // Convert the data URL to a blob
        const blob = convertDataUrlToFile({ dataUrl: logo });
        // Upload the blob to vercel storage
        blobUrl = await uploadImage(blob);
        setLogo(blobUrl);
      }

      let bannerBlobUrl: string | null =
        banner && banner.startsWith("data:") ? null : banner;
      // Don't upload if banner is set to hide
      if (banner && banner.startsWith("data:")) {
        // Convert the data URL to a blob
        const blob = convertDataUrlToFile({ dataUrl: banner });
        // Upload the blob to vercel storage
        bannerBlobUrl = await uploadImage(blob);
        setBanner(bannerBlobUrl);
      } else if (banner === "no-banner") {
        // Use the special value to hide the banner
        bannerBlobUrl = "no-banner";
      }

      let linkPreviewImageUrl: string | null =
        linkPreviewImage && linkPreviewImage.startsWith("data:")
          ? null
          : linkPreviewImage;
      if (linkPreviewImage?.startsWith("data:")) {
        const blob = convertDataUrlToFile({ dataUrl: linkPreviewImage });
        linkPreviewImageUrl = await uploadImage(blob);
        setLinkPreviewImage(linkPreviewImageUrl);
      }

      let linkPreviewFaviconUrl: string | null =
        linkPreviewFavicon && linkPreviewFavicon.startsWith("data:")
          ? null
          : linkPreviewFavicon;
      if (linkPreviewFavicon?.startsWith("data:")) {
        const blob = convertDataUrlToFile({ dataUrl: linkPreviewFavicon });
        linkPreviewFaviconUrl = await uploadImage(blob);
        setLinkPreviewFavicon(linkPreviewFaviconUrl);
      }

      const data = {
        welcomeMessage: hasBusinessMessagingAccess
          ? welcomeEnabled
            ? welcomeMessage.trim() || DEFAULT_WELCOME_MESSAGE
            : null
          : ((dataroomBrand as any)?.welcomeMessage ?? null),
        brandColor: brandColor,
        accentColor: accentColor,
        accentButtonColor: accentButtonColor,
        applyAccentColorToDataroomView,
        logo: blobUrl,
        hideLogo: hideLogo,
        banner: bannerBlobUrl,
        cardLayout,
        showFolderTree,
        viewerLayoutPreset: derivedLayoutPreset,
        viewerHeaderStyle,
        hideFolderIconsInMain,
        ctaLabel: hasBusinessMessagingAccess
          ? ctaEnabled
            ? ctaLabel.trim() || null
            : null
          : ((dataroomBrand as any)?.ctaLabel ?? null),
        ctaUrl: hasBusinessMessagingAccess
          ? ctaEnabled
            ? ctaUrl.trim() || null
            : null
          : ((dataroomBrand as any)?.ctaUrl ?? null),
        customLinkPreviewEnabled: linkPreviewEnabled,
        linkPreviewTitle: linkPreviewEnabled
          ? linkPreviewTitle.trim() || null
          : null,
        linkPreviewDescription: linkPreviewEnabled
          ? linkPreviewDescription.trim() || null
          : null,
        linkPreviewImage: linkPreviewEnabled ? linkPreviewImageUrl : null,
        linkPreviewFavicon: linkPreviewEnabled ? linkPreviewFaviconUrl : null,
        defaultLanguage,
      };

      const brandingUrl = `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroom.id}/branding`;
      const dataroomUrl = `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroom.id}`;
      const res = await fetch(brandingUrl, {
        method: dataroomBrand ? "PUT" : "POST",
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        toast.error("Failed to update branding");
        return;
      }

      await mutate(brandingUrl);

      if (!isCustomBrand) {
        const unstickRes = await fetch(dataroomUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brandId: null }),
        });
        if (!unstickRes.ok) {
          toast.error(
            "Saved branding, but failed to switch to a custom brand",
          );
          return;
        }
        await mutate(dataroomUrl);
        await mutate(brandingUrl);
      }

      setOriginalBanner(data.banner);
      initialLanguageRef.current = defaultLanguage;
      initialLayoutSnapshotRef.current = {
        cardLayout,
        showFolderTree,
        viewerHeaderStyle,
        hideFolderIconsInMain,
      };
      sourceBrandSnapshotRef.current = {
        brandColor,
        accentColor,
        accentButtonColor,
        applyAccentColorToDataroomView,
        logo: data.logo,
        hideLogo,
        banner: data.banner,
        welcomeMessage,
        welcomeEnabled,
        cardLayout,
        showFolderTree,
        viewerHeaderStyle,
        hideFolderIconsInMain,
        ctaLabel,
        ctaUrl,
        ctaEnabled,
        linkPreviewEnabled,
        linkPreviewTitle,
        linkPreviewDescription,
        linkPreviewImage: data.linkPreviewImage,
        linkPreviewFavicon: data.linkPreviewFavicon,
        defaultLanguage,
      };
      toast.success(
        isCustomBrand
          ? "Branding updated successfully"
          : "Saved as custom brand",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    setIsLoading(true);

    const res = await fetch(
      `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroom.id}/branding`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    if (res.ok) {
      await mutate(
        `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroom.id}/branding`,
        null,
        { revalidate: false },
      );
      applyEmptyCustomBrand();
      setIsLoading(false);
      toast.success("Branding reset successfully");
    } else {
      setIsLoading(false);
      toast.error("Failed to reset branding");
    }
  };

  // Build preview params with all branding + layout values so the embedded
  // demo page can render an accurate preview. Shared by the initial iframe URL
  // and the live postMessage stream (see `BrandingPreviewFrame`).
  const buildRoomPreviewParams = (): Record<string, string> => {
    const params: Record<string, string> = {
      brandColor: debouncedBrandColor,
      accentColor: debouncedAccentColor,
      applyAccentColorToDataroomView: applyAccentColorToDataroomView
        ? "1"
        : "0",
      cardLayout,
      showFolderTree: showFolderTree ? "1" : "0",
      viewerHeaderStyle,
      hideFolderIconsInMain: hideFolderIconsInMain ? "1" : "0",
      hideLogo: hideLogo ? "1" : "0",
    };
    const logoSrc = blobUrl || logo || "";
    if (logoSrc) params.brandLogo = logoSrc;
    const bannerSrc =
      banner === "no-banner" ? "no-banner" : bannerBlobUrl || banner || "";
    if (bannerSrc) params.brandBanner = bannerSrc;
    // When the toggle is on we always render a preview button so the user can
    // see the styling, even before they type a label/url. Real viewers still
    // require both fields.
    if (hasBusinessMessagingAccess && ctaEnabled) {
      params.ctaLabel = ctaLabel.trim() || "Book a call";
      params.ctaUrl = ctaUrl.trim() || "#";
    }
    if (accentButtonColor) params.accentButtonColor = accentButtonColor;
    return params;
  };

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mb-0 lg:mt-8 lg:flex lg:h-[calc(100vh-7rem)] lg:flex-col xl:mx-10">
        <div className="mb-4 flex items-center justify-between gap-4 md:mb-6 lg:shrink-0">
          <div className="max-w-3xl space-y-2">
            <h3 className="text-2xl font-semibold tracking-tight text-foreground">
              Dataroom Branding
            </h3>
            <div className="text-sm text-muted-foreground">
              <p>
                Customize your data room&apos;s branding for a cohesive user
                experience.{" "}
                <BadgeTooltip
                  linkText="Click here"
                  content="How to customize data room branding?"
                  key="branding"
                  link="https://www.papermark.com/help/article/dataroom-branding"
                >
                  <CircleHelpIcon className="inline-block h-4 w-4 shrink-0 align-text-bottom text-muted-foreground hover:text-foreground" />
                </BadgeTooltip>
              </p>
            </div>
          </div>
        </div>

        {brands.length > 0 ? (
          <div className="mb-4 max-w-md space-y-1">
            <Label>Brand</Label>
            <Select
              value={dataroom?.brandId ?? CUSTOM_DATAROOM_BRAND}
              onValueChange={async (value) => {
                const teamId = teamInfo?.currentTeam?.id;
                if (!teamId || !dataroom?.id) return;
                const res = await fetch(
                  `/api/teams/${teamId}/datarooms/${dataroom.id}`,
                  {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      brandId: value === CUSTOM_DATAROOM_BRAND ? null : value,
                    }),
                  },
                );
                if (!res.ok) {
                  toast.error("Failed to update brand");
                  return;
                }
                const nextBrandId =
                  value === CUSTOM_DATAROOM_BRAND ? null : value;
                await mutate(
                  `/api/teams/${teamId}/datarooms/${dataroom.id}`,
                  (current) =>
                    current ? { ...current, brandId: nextBrandId } : current,
                  { revalidate: true },
                );
                await mutate(
                  `/api/teams/${teamId}/datarooms/${dataroom.id}/branding`,
                );
                toast.success(
                  value === CUSTOM_DATAROOM_BRAND
                    ? "Using custom brand"
                    : "Using team brand",
                );
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={CUSTOM_DATAROOM_BRAND_LABEL} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CUSTOM_DATAROOM_BRAND}>
                  {CUSTOM_DATAROOM_BRAND_LABEL}
                </SelectItem>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel className="text-xs font-normal text-muted-foreground">
                    Inherit from team brands
                  </SelectLabel>
                  {brands.map((item) => (
                    <SelectItem
                      key={item.id}
                      value={item.id}
                      className={
                        item.id === defaultBrandId ? "pr-16" : undefined
                      }
                    >
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {isCustomBrand ? null : (
              <p className="text-xs text-muted-foreground">
                {hasInheritedEdits
                  ? "Saving will switch this data room to a custom brand based on the selected team brand."
                  : "This data room is using a team brand. Edit any setting and save to override it with a custom brand."}
              </p>
            )}
          </div>
        ) : null}

        <div className="flex w-full flex-col gap-6 lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-8">
          {/* Settings Column */}
          <div className="flex w-full flex-col gap-6 lg:min-h-0 lg:w-[420px] lg:shrink-0">
            {/* Scrollable Settings */}
            <Tabs
              defaultValue="branding"
              className="flex w-full flex-col lg:min-h-0 lg:flex-1"
            >
              <TabsList className="grid w-full shrink-0 grid-cols-2">
                <TabsTrigger value="branding">Branding</TabsTrigger>
                <TabsTrigger value="layouts" className="gap-1.5">
                  Layouts
                  <span className="inline-flex items-center rounded-[4px] bg-orange-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide text-white">
                    New
                  </span>
                </TabsTrigger>
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
                          Paste a website URL and we&apos;ll pull logo, banner
                          and brand colors automatically. You can still tweak
                          everything below before saving.
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
                                    setHideLogoOverride(false);
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
                              id="dataroom-hide-logo"
                              checked={hideLogo}
                              onCheckedChange={(checked) =>
                                setHideLogoOverride(checked === true)
                              }
                              className="mt-0.5"
                            />
                            <div className="space-y-1">
                              <Label
                                htmlFor="dataroom-hide-logo"
                                className="cursor-pointer text-sm font-medium"
                              >
                                Show no logo
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                {isCustomBrand || hasInheritedEdits
                                  ? "Visitors see no logo at all, not even the Papermark logo."
                                  : "This setting comes from the selected team brand."}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Banner Card */}
                  <Card>
                    <CardContent className="space-y-3 pt-6">
                      <BannerEditor
                        banner={banner}
                        setBanner={setBanner}
                        setBannerBlobUrl={setBannerBlobUrl}
                        sizeHint="(max 5 MB, min. 1920×320)"
                        defaultBannerImage={DEFAULT_BANNER_IMAGE}
                        onUrlApplied={() => {
                          // Pasting a banner URL (image/video/YouTube) is a strong
                          // signal the user wants a richer hero — auto-promote the
                          // Standard preset to Modern. Other presets stay put.
                          if (derivedLayoutPreset === "STANDARD") {
                            applyLayoutPreset("MODERN");
                          }
                        }}
                        dropZone={
                          <>
                            <label
                              htmlFor="banner"
                              className="group relative flex h-24 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 transition-all hover:border-gray-400 hover:bg-gray-100"
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
                                    e.dataTransfer.files &&
                                    e.dataTransfer.files[0];
                                  if (file) {
                                    if (file.size / 1024 / 1024 > 5) {
                                      setFileError(
                                        "File size too big (max 5MB)",
                                      );
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
                                        const dataUrl = e.target
                                          ?.result as string;
                                        setBanner(dataUrl);
                                        setOriginalBanner(dataUrl);
                                        const blob = convertDataUrlToFile({
                                          dataUrl,
                                        });
                                        const bannerBlobUrl =
                                          URL.createObjectURL(blob);
                                        setBannerBlobUrl(bannerBlobUrl);
                                      };
                                      reader.readAsDataURL(file);
                                    }
                                  }
                                }}
                              />
                              {!banner || banner === DEFAULT_BANNER_IMAGE ? (
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
                              ) : banner === "no-banner" ? (
                                <div className="flex flex-col items-center justify-center gap-2">
                                  <p className="text-center text-sm font-medium text-gray-600">
                                    Banner Hidden <br />
                                    Upload to add banner
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
                      {banner === "no-banner" && (
                        <p className="text-xs text-muted-foreground">
                          Banner is hidden — turn it on in Layouts → Banner to
                          show it.
                        </p>
                      )}
                      {banner &&
                      banner !== "no-banner" &&
                      banner !== DEFAULT_BANNER_IMAGE &&
                      !banner.startsWith("data:") &&
                      banner !== originalBanner ? (
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setBanner(originalBanner)}
                            className="text-xs"
                          >
                            {originalBanner === DEFAULT_BANNER_IMAGE
                              ? "Use Default Banner"
                              : "Restore Banner"}
                          </Button>
                        </div>
                      ) : null}
                      {fileError && (
                        <p className="text-sm text-red-500">{fileError}</p>
                      )}
                    </CardContent>
                  </Card>

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
                            (front page &amp; document view)
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
                        <div className="flex items-start space-x-2 pt-2">
                          <Checkbox
                            id="apply-accent-to-dataroom-view"
                            checked={applyAccentColorToDataroomView}
                            onCheckedChange={(checked) =>
                              setApplyAccentColorToDataroomView(
                                checked === true,
                              )
                            }
                          />
                          <div className="space-y-1">
                            <Label
                              htmlFor="apply-accent-to-dataroom-view"
                              className="cursor-pointer"
                            >
                              Also apply this background color to dataroom view
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              When disabled, dataroom view stays white.
                            </p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <CollapsibleBrandingSection
                    title="Language"
                    defaultOpen={false}
                  >
                    <div className="flex flex-col gap-6">
                      <VisitorLanguageCard
                        defaultLanguage={defaultLanguage}
                        onDefaultLanguageChange={setDefaultLanguage}
                        hasAccess={hasVisitorLanguageAccess}
                      />
                    </div>
                  </CollapsibleBrandingSection>

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
                                  <Label htmlFor="dataroom-cta-enabled">
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
                                  Renders in the nav when enabled. Falls back to
                                  global branding when off.
                                </p>
                              </div>
                              <Switch
                                id="dataroom-cta-enabled"
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
                                  <Label htmlFor="dataroom-cta-label">
                                    Button label
                                  </Label>
                                  <Input
                                    id="dataroom-cta-label"
                                    disabled={!hasBusinessMessagingAccess}
                                    placeholder="Book a meeting"
                                    value={ctaLabel}
                                    onChange={(e) =>
                                      setCtaLabel(e.target.value)
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="dataroom-cta-url">Link</Label>
                                  <Input
                                    id="dataroom-cta-url"
                                    disabled={!hasBusinessMessagingAccess}
                                    placeholder="https://..."
                                    value={ctaUrl}
                                    onChange={(e) => setCtaUrl(e.target.value)}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="dataroom-accent-button-color">
                                    Button color{" "}
                                    <span className="font-normal text-muted-foreground">
                                      (accent)
                                    </span>
                                  </Label>
                                  <div
                                    className={cn(
                                      "flex items-center space-x-3",
                                      !hasBusinessMessagingAccess &&
                                        "pointer-events-none opacity-60",
                                    )}
                                  >
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
                                  <Label htmlFor="dataroom-welcome-enabled">
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
                                id="dataroom-welcome-enabled"
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
                                          setPreviewTab("access-view");
                                        }
                                      }
                                }
                              />
                            </div>
                            {welcomeEnabled && (
                              <div className="space-y-3 border-t pt-4">
                                <div className="flex items-center justify-between">
                                  <Label
                                    htmlFor="dataroom-welcome-message"
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
                                  id="dataroom-welcome-message"
                                  disabled={!hasBusinessMessagingAccess}
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

                      <Card>
                        <CardContent className="pt-6">
                          <BrandingLinkPreviewForm
                            enabled={linkPreviewEnabled}
                            onEnabledChange={(v) => {
                              setLinkPreviewEnabled(v);
                              if (v) setPreviewTab("shared-link-preview");
                            }}
                            title={linkPreviewTitle}
                            onTitleChange={setLinkPreviewTitle}
                            description={linkPreviewDescription}
                            onDescriptionChange={setLinkPreviewDescription}
                            imageUrl={linkPreviewImage}
                            onImageChange={setLinkPreviewImage}
                            faviconUrl={linkPreviewFavicon}
                            onFaviconChange={setLinkPreviewFavicon}
                            inheritanceHint="For this dataroom, empty fields fall back to team branding when both are enabled."
                          />
                        </CardContent>
                      </Card>
                    </div>
                  </CollapsibleBrandingSection>
                </FadeScrollArea>
              </TabsContent>

              <TabsContent
                value="layouts"
                className="mt-4 focus-visible:outline-none lg:min-h-0 lg:flex-1"
              >
                <FadeScrollArea
                  className="lg:h-full"
                  showScrollbar
                  contentClassName="flex flex-col gap-6 lg:pr-2.5"
                >
                  <>
                    <Card>
                      <CardContent className="min-w-0 space-y-3 pt-6">
                        <div>
                          <Label>Data Room layout</Label>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Choose a preset — the options below update to match.
                            Mixing toggles manually switches to a custom
                            combination.
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

                    {/* Banner visibility */}
                    <Card>
                      <CardContent className="pt-6">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="banner-visible">Banner</Label>
                            <Switch
                              id="banner-visible"
                              checked={banner !== "no-banner"}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  const restored =
                                    lastVisibleBannerRef.current ??
                                    (originalBanner &&
                                    originalBanner !== "no-banner"
                                      ? originalBanner
                                      : null) ??
                                    DEFAULT_BANNER_IMAGE;
                                  setBanner(restored);
                                } else {
                                  if (banner && banner !== "no-banner") {
                                    lastVisibleBannerRef.current = banner;
                                  }
                                  setBanner("no-banner");
                                }
                              }}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Show a banner image or video at the top of the
                            dataroom. Upload a file or paste a URL (image,
                            video, or YouTube) under Brand identity → Banner.
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Folder tree (left navigation) */}
                    <Card>
                      <CardContent className="pt-6">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="show-folder-tree">
                              Navigation tree
                            </Label>
                            <Switch
                              id="show-folder-tree"
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
                                htmlFor={`card-layout-${opt.value}`}
                                className={cn(
                                  "flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs",
                                  cardLayout === opt.value &&
                                    "border-black bg-gray-50",
                                )}
                              >
                                <RadioGroupItem
                                  value={opt.value}
                                  id={`card-layout-${opt.value}`}
                                />
                                {opt.label}
                              </Label>
                            ))}
                          </RadioGroup>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                </FadeScrollArea>
              </TabsContent>
            </Tabs>

            {/* Action Buttons - Always Visible */}
            <div className="flex items-center gap-4 border-t bg-background pt-4 lg:sticky lg:bottom-0 lg:z-10 lg:shrink-0 lg:pb-2">
              {blocksSave && canSaveBranding ? (
                <UpgradeButton
                  text={languageBlocksSave ? "save changes" : "Save changes"}
                  clickedPlan={
                    languageBlocksSave
                      ? PlanEnum.DataRoomsPlus
                      : PlanEnum.DataRooms
                  }
                  trigger={
                    languageBlocksSave
                      ? "dataroom_branding_language_save"
                      : "dataroom_branding_layouts_save"
                  }
                  highlightItem={[
                    ...(layoutBlocksSave ? ["dataroom-viewer-layouts"] : []),
                    ...(languageBlocksSave ? ["dataroom-localisation"] : []),
                  ]}
                  hideItems={["datarooms"]}
                />
              ) : (
                <Button
                  onClick={saveBranding}
                  loading={isLoading}
                  disabled={
                    !canSaveBranding ||
                    (hasBusinessMessagingAccess && !!welcomeMessageError)
                  }
                  className="bg-black text-white hover:bg-gray-800"
                >
                  {hasInheritedEdits
                    ? "Override custom brand"
                    : "Save changes"}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={handleDelete}
                disabled={!isCustomBrand || !dataroomBrand}
              >
                Reset branding
              </Button>
            </div>
            <UpgradePlanModal
              clickedPlan={
                languageBlocksSave ? PlanEnum.DataRoomsPlus : PlanEnum.DataRooms
              }
              trigger={
                languageBlocksSave
                  ? "dataroom_branding_language_save"
                  : "dataroom_branding_layouts_save"
              }
              highlightItem={[
                ...(layoutBlocksSave ? ["dataroom-viewer-layouts"] : []),
                ...(languageBlocksSave ? ["dataroom-localisation"] : []),
              ]}
              hideItems={["datarooms"]}
              open={upgradeLayoutsModalOpen}
              setOpen={setUpgradeLayoutsModalOpen}
            />
            <UpgradePlanModal
              clickedPlan={PlanEnum.Business}
              trigger="dataroom_branding_welcome_cta"
              highlightItem={["custom-welcome-message", "custom-cta"]}
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
                    linkPreviewEnabled
                      ? "grid-cols-2 sm:grid-cols-4"
                      : "grid-cols-3",
                  )}
                >
                  <TabsTrigger value="dataroom-view">Dataroom View</TabsTrigger>
                  <TabsTrigger value="document-view">Document View</TabsTrigger>
                  <TabsTrigger value="access-view">Front Page</TabsTrigger>
                  {linkPreviewEnabled && (
                    <TabsTrigger value="shared-link-preview">
                      Shared link preview
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>
              {/* Dataroom View */}
              <TabsContent
                value="dataroom-view"
                className="mt-6 lg:mt-4 lg:min-h-0 lg:flex-1"
              >
                <BrandingPreviewChrome
                  name="dataroom-view"
                  basePath="/room_ppreview_demo"
                  urlLabel="papermark.com/dataroom/..."
                  params={buildRoomPreviewParams()}
                />
              </TabsContent>
              {/* Document View */}
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
                  }}
                />
              </TabsContent>
              <TabsContent
                value="access-view"
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
              {linkPreviewEnabled && (
                <TabsContent
                  value="shared-link-preview"
                  className="mt-6 lg:mt-4 lg:min-h-0 lg:flex-1"
                >
                  <div className="mx-auto flex max-w-xl justify-center lg:h-full lg:items-center">
                    <BrandingSocialPreviewReadonly
                      title={debouncedLinkPreviewTitle}
                      description={debouncedLinkPreviewDescription}
                      image={debouncedLinkPreviewImage}
                      favicon={debouncedLinkPreviewFavicon}
                    />
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
