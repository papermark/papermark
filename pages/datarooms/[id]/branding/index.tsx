import { useRouter } from "next/router";

import { useCallback, useEffect, useState } from "react";

import { useTeam } from "@/context/team-context";
import { Check, CircleHelpIcon, UploadIcon } from "lucide-react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import sanitizeHtml from "sanitize-html";
import { toast } from "sonner";
import { mutate } from "swr";
import { useDebounce } from "use-debounce";

import { useBrand, useDataroomBrand } from "@/lib/swr/use-brand";
import { useDataroom } from "@/lib/swr/use-dataroom";
import { cn, convertDataUrlToFile, uploadImage } from "@/lib/utils";

import AppLayout from "@/components/layouts/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { BadgeTooltip } from "@/components/ui/tooltip";

const DEFAULT_BANNER_IMAGE = "/_static/papermark-banner.png";

export default function DataroomBrandPage() {
  const router = useRouter();
  const teamInfo = useTeam();
  const { dataroom } = useDataroom();
  const { brand: dataroomBrand } = useDataroomBrand({
    dataroomId: dataroom?.id,
  });
  const { brand: globalBrand } = useBrand();

  const [brandColor, setBrandColor] = useState<string>("#000000");
  const [accentColor, setAccentColor] = useState<string>("#FFFFFF");
  const [applyAccentColorToDataroomView, setApplyAccentColorToDataroomView] =
    useState<boolean>(false);
  const [logo, setLogo] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [originalBanner, setOriginalBanner] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [bannerBlobUrl, setBannerBlobUrl] = useState<string | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState<string>(
    "Your action is requested to continue",
  );
  const [debouncedBrandColor] = useDebounce(brandColor, 300);
  const [debouncedAccentColor] = useDebounce(accentColor, 300);
  const [debouncedWelcomeMessage] = useDebounce(welcomeMessage, 500);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [welcomeMessageError, setWelcomeMessageError] = useState<string | null>(
    null,
  );

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

  useEffect(() => {
    // Merge dataroom brand with global brand as fallback
    if (dataroomBrand || globalBrand) {
      setBrandColor(
        dataroomBrand?.brandColor || globalBrand?.brandColor || "#000000",
      );
      setAccentColor(
        dataroomBrand?.accentColor || globalBrand?.accentColor || "#FFFFFF",
      );
      setApplyAccentColorToDataroomView(
        (dataroomBrand as any)?.applyAccentColorToDataroomView ??
          (globalBrand as any)?.applyAccentColorToDataroomView ??
          false,
      );
      setLogo(dataroomBrand?.logo || globalBrand?.logo || null);
      const bannerValue = dataroomBrand?.banner || globalBrand?.banner || null;
      setBanner(bannerValue);
      setOriginalBanner(bannerValue);
      const message =
        dataroomBrand?.welcomeMessage ||
        globalBrand?.welcomeMessage ||
        "Your action is requested to continue";
      setWelcomeMessage(message);
      // Validate existing message
      const error = validateWelcomeMessage(message);
      setWelcomeMessageError(error);
    }
  }, [dataroomBrand, globalBrand]);

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

    // Validate welcome message before saving
    const welcomeError = validateWelcomeMessage(welcomeMessage);
    if (welcomeError) {
      setWelcomeMessageError(welcomeError);
      toast.error("Please fix the validation errors before saving");
      return;
    }

    setIsLoading(true);

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

    const data = {
      welcomeMessage:
        welcomeMessage.trim() || "Your action is requested to continue",
      brandColor: brandColor,
      accentColor: accentColor,
      applyAccentColorToDataroomView,
      logo: blobUrl,
      banner: bannerBlobUrl,
    };

    const res = await fetch(
      `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroom.id}/branding`,
      {
        method: dataroomBrand ? "PUT" : "POST",
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    if (res.ok) {
      mutate(
        `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroom.id}/branding`,
      );
      // Update the original banner state to the new saved value
      setOriginalBanner(data.banner);
      setIsLoading(false);
      toast.success("Branding updated successfully");
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
      setLogo(null);
      setBanner(DEFAULT_BANNER_IMAGE);
      setOriginalBanner(DEFAULT_BANNER_IMAGE);
      setBrandColor("#000000");
      setApplyAccentColorToDataroomView(
        (globalBrand as any)?.applyAccentColorToDataroomView ?? false,
      );
      setIsLoading(false);
      toast.success("Branding reset successfully");
      router.reload();
    }
  };

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-8 px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="mb-4 flex items-center justify-between md:mb-8 lg:mb-12">
          <div className="space-y-1">
            <h3 className="text-2xl font-semibold tracking-tight text-foreground">
              Dataroom Branding
            </h3>
            <p className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
              Customize your data room&apos;s branding for a cohesive user
              experience.
              <BadgeTooltip
                linkText="Click here"
                content="How to customize data room branding?"
                key="branding"
                link="https://www.papermark.com/help/article/dataroom-branding"
              >
                <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
              </BadgeTooltip>
            </p>
          </div>
        </div>

        {/* Main Layout */}
        <div className="flex w-full flex-col gap-6 lg:flex-row lg:gap-8">
          {/* Settings Column */}
          <div className="flex w-full flex-col gap-6 lg:w-[420px] lg:shrink-0">
            {/* Scrollable Settings */}
            <div className="flex flex-col gap-6 lg:max-h-[calc(100vh-400px)] lg:overflow-y-auto lg:pr-4">
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
                            className="max-h-full max-w-full object-contain"
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
                  </div>
                </CardContent>
              </Card>

              {/* Banner Card */}
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-2">
                    <Label htmlFor="banner">
                      Banner{" "}
                      <span className="font-normal text-muted-foreground">
                        (max 5 MB, min. 1920×320)
                      </span>
                    </Label>
                    <label
                      htmlFor="banner"
                      className="group relative mt-2 flex h-20 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 transition-all hover:border-gray-400 hover:bg-gray-100"
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
                            if (file.size / 1024 / 1024 > 5) {
                              setFileError("File size too big (max 5MB)");
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
                                setBanner(dataUrl);
                                // When uploading a new image, this becomes the new "original" until saved
                                setOriginalBanner(dataUrl);
                                const blob = convertDataUrlToFile({
                                  dataUrl,
                                });
                                const bannerBlobUrl = URL.createObjectURL(blob);
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
                        <div className="relative flex h-full w-full items-center justify-center p-4">
                          <img
                            src={banner}
                            alt="Banner preview"
                            className="max-h-full max-w-full object-contain"
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
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setBanner("no-banner")}
                        className={cn(
                          "text-xs",
                          banner === "no-banner" && "border-black",
                        )}
                      >
                        Hide Banner
                      </Button>
                      {(banner === "no-banner" &&
                        originalBanner !== "no-banner") ||
                      (banner &&
                        banner !== DEFAULT_BANNER_IMAGE &&
                        !banner.startsWith("data:") &&
                        banner !== originalBanner) ? (
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
                      ) : null}
                    </div>
                    {fileError && (
                      <p className="text-sm text-red-500">{fileError}</p>
                    )}
                  </div>
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
                          setApplyAccentColorToDataroomView(checked === true)
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

              {/* Welcome Message Card */}
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="accent-color">
                        Welcome Message{" "}
                        <span className="font-normal text-muted-foreground">
                          (front page)
                        </span>
                      </Label>
                      <span className="text-sm text-muted-foreground">
                        <span
                          className={cn(welcomeMessageError && "text-red-500")}
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
                      placeholder="Your action is requested to continue"
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
                      Keep the message concise - it should fit within two lines
                      for the best user experience.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Action Buttons - Always Visible */}
            <div className="flex items-center gap-4 border-t bg-background pt-4">
              <Button
                onClick={saveBranding}
                loading={isLoading}
                disabled={!!welcomeMessageError}
              >
                Save changes
              </Button>
              <Button
                variant="ghost"
                onClick={handleDelete}
                disabled={!dataroomBrand}
              >
                Reset branding
              </Button>
            </div>
          </div>

          {/* Separator Line */}
          <div className="hidden lg:block lg:w-px lg:self-stretch lg:bg-border"></div>

          {/* Preview Column */}
          <div className="flex-1 lg:pl-4">
            <Tabs defaultValue="dataroom-view" className="w-full">
              <div className="w-full overflow-x-auto">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="dataroom-view">Dataroom View</TabsTrigger>
                  <TabsTrigger value="document-view">Document View</TabsTrigger>
                  <TabsTrigger value="access-view">Front Page</TabsTrigger>
                </TabsList>
              </div>
              {/* Dataroom View */}
              <TabsContent value="dataroom-view" className="mt-6">
                <div className="flex justify-center">
                  <div
                    className="relative w-full max-w-[698px] rounded-lg bg-gray-200 p-1 shadow-lg"
                    style={{ height: "450px" }}
                  >
                    <div className="relative flex h-full flex-col overflow-hidden rounded-lg bg-gray-100">
                      <div className="mx-auto flex h-7 shrink-0 items-center justify-center">
                        <div className="pointer-events-none absolute left-3">
                          <div className="flex flex-row flex-nowrap justify-start">
                            <div className="pointer-events-auto">
                              <div className="mr-1 inline-block size-2 rounded-full bg-gray-300"></div>
                            </div>
                            <div className="pointer-events-auto">
                              <div className="mr-1 inline-block size-2 rounded-full bg-gray-300"></div>
                            </div>
                            <div className="pointer-events-auto">
                              <div className="mr-1 inline-block size-2 rounded-full bg-gray-300"></div>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-center rounded-xl bg-white p-1 px-2 opacity-70">
                          <div
                            aria-hidden="true"
                            className="mr-1 mt-0.5 flex text-muted-foreground"
                          >
                            <svg
                              aria-hidden="true"
                              height="8"
                              width="8"
                              viewBox="0 0 16 16"
                              fill="currentColor"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path d="M8.75 11.25a1.25 1.25 0 1 0-1.5 0v1a.75.75 0 0 0 1.5 0v-1Z"></path>
                              <path
                                fillRule="evenodd"
                                clipRule="evenodd"
                                d="M3.5 4v2h-1a1 1 0 0 0-1 1v6a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3V7a1 1 0 0 0-1-1h-1V4a4 4 0 0 0-4-4h-1a4 4 0 0 0-4 4ZM11 6V4a2.5 2.5 0 0 0-2.5-2.5h-1A2.5 2.5 0 0 0 5 4v2h6Zm-8 7V7.5h10V13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13Z"
                              ></path>
                            </svg>
                          </div>
                          <span className="whitespace-normal text-xs text-muted-foreground">
                            papermark.com/dataroom/...
                          </span>
                        </div>
                      </div>
                      <div className="relative min-h-0 flex-1 overflow-x-auto">
                        <div className="relative h-full max-w-[1396px]">
                          <iframe
                            key={`dataroom-view-${debouncedBrandColor}-${debouncedAccentColor}-${banner}`}
                            name="dataroom-view"
                            id="dataroom-view"
                            src={`/room_ppreview_demo?brandColor=${encodeURIComponent(debouncedBrandColor)}&accentColor=${encodeURIComponent(debouncedAccentColor)}&applyAccentColorToDataroomView=${applyAccentColorToDataroomView ? "1" : "0"}&brandLogo=${blobUrl ? encodeURIComponent(blobUrl) : logo ? encodeURIComponent(logo) : ""}&brandBanner=${banner === "no-banner" ? encodeURIComponent("no-banner") : bannerBlobUrl ? encodeURIComponent(bannerBlobUrl) : banner ? encodeURIComponent(banner) : ""}`}
                            className="absolute left-0 top-0 h-full w-full origin-top-left scale-50 overflow-hidden rounded-b-lg border-0 bg-white"
                            style={{
                              width: "200%",
                              height: "200%",
                              pointerEvents: "none",
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>
              {/* Document View */}
              <TabsContent value="document-view" className="mt-6">
                <div className="flex justify-center">
                  <div
                    className="relative w-full max-w-[698px] rounded-lg bg-gray-200 p-1 shadow-lg"
                    style={{ height: "450px" }}
                  >
                    <div className="relative flex h-full flex-col overflow-hidden rounded-lg bg-gray-100">
                      <div className="mx-auto flex h-7 shrink-0 items-center justify-center">
                        <div className="pointer-events-none absolute left-3">
                          <div className="flex flex-row flex-nowrap justify-start">
                            <div className="pointer-events-auto">
                              <div className="mr-1 inline-block size-2 rounded-full bg-gray-300"></div>
                            </div>
                            <div className="pointer-events-auto">
                              <div className="mr-1 inline-block size-2 rounded-full bg-gray-300"></div>
                            </div>
                            <div className="pointer-events-auto">
                              <div className="mr-1 inline-block size-2 rounded-full bg-gray-300"></div>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-center rounded-xl bg-white p-1 px-2 opacity-70">
                          <div
                            aria-hidden="true"
                            className="mr-1 mt-0.5 flex text-muted-foreground"
                          >
                            <svg
                              aria-hidden="true"
                              height="8"
                              width="8"
                              viewBox="0 0 16 16"
                              fill="currentColor"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path d="M8.75 11.25a1.25 1.25 0 1 0-1.5 0v1a.75.75 0 0 0 1.5 0v-1Z"></path>
                              <path
                                fillRule="evenodd"
                                clipRule="evenodd"
                                d="M3.5 4v2h-1a1 1 0 0 0-1 1v6a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3V7a1 1 0 0 0-1-1h-1V4a4 4 0 0 0-4-4h-1a4 4 0 0 0-4 4ZM11 6V4a2.5 2.5 0 0 0-2.5-2.5h-1A2.5 2.5 0 0 0 5 4v2h6Zm-8 7V7.5h10V13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13Z"
                              ></path>
                            </svg>
                          </div>
                          <span className="whitespace-normal text-xs text-muted-foreground">
                            papermark.com/view/...
                          </span>
                        </div>
                      </div>
                      <div className="relative min-h-0 flex-1 overflow-x-auto">
                        <div className="relative h-full max-w-[1396px]">
                          <iframe
                            key={`document-view-${debouncedBrandColor}-${debouncedAccentColor}`}
                            name="document-view"
                            id="document-view"
                            src={`/nav_ppreview_demo?brandColor=${encodeURIComponent(debouncedBrandColor)}&accentColor=${encodeURIComponent(debouncedAccentColor)}&brandLogo=${blobUrl ? encodeURIComponent(blobUrl) : logo ? encodeURIComponent(logo) : ""}`}
                            className="absolute left-0 top-0 h-full w-full origin-top-left scale-50 overflow-hidden rounded-b-lg border-0 bg-white"
                            style={{
                              width: "200%",
                              height: "200%",
                              pointerEvents: "none",
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="access-view" className="mt-6">
                <div className="flex justify-center">
                  <div
                    className="relative w-full max-w-[698px] rounded-lg bg-gray-200 p-1 shadow-lg"
                    style={{ height: "450px" }}
                  >
                    <div className="relative flex h-full flex-col overflow-hidden rounded-lg bg-gray-100">
                      <div className="mx-auto flex h-7 shrink-0 items-center justify-center">
                        <div className="pointer-events-none absolute left-3">
                          <div className="flex flex-row flex-nowrap justify-start">
                            <div className="pointer-events-auto">
                              <div className="mr-1 inline-block size-2 rounded-full bg-gray-300"></div>
                            </div>
                            <div className="pointer-events-auto">
                              <div className="mr-1 inline-block size-2 rounded-full bg-gray-300"></div>
                            </div>
                            <div className="pointer-events-auto">
                              <div className="mr-1 inline-block size-2 rounded-full bg-gray-300"></div>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-center rounded-xl bg-white p-1 px-2 opacity-70">
                          <div
                            aria-hidden="true"
                            className="mr-1 mt-0.5 flex text-muted-foreground"
                          >
                            <svg
                              aria-hidden="true"
                              height="8"
                              width="8"
                              viewBox="0 0 16 16"
                              fill="currentColor"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path d="M8.75 11.25a1.25 1.25 0 1 0-1.5 0v1a.75.75 0 0 0 1.5 0v-1Z"></path>
                              <path
                                fillRule="evenodd"
                                clipRule="evenodd"
                                d="M3.5 4v2h-1a1 1 0 0 0-1 1v6a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3V7a1 1 0 0 0-1-1h-1V4a4 4 0 0 0-4-4h-1a4 4 0 0 0-4 4ZM11 6V4a2.5 2.5 0 0 0-2.5-2.5h-1A2.5 2.5 0 0 0 5 4v2h6Zm-8 7V7.5h10V13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13Z"
                              ></path>
                            </svg>
                          </div>
                          <span className="whitespace-normal text-xs text-muted-foreground">
                            papermark.com/view/...
                          </span>
                        </div>
                      </div>
                      <div className="relative min-h-0 flex-1 overflow-x-auto">
                        <div className="relative h-full max-w-[1396px]">
                          <iframe
                            key={`access-screen-${debouncedBrandColor}-${debouncedAccentColor}-${debouncedWelcomeMessage}`}
                            name="access-screen"
                            id="access-screen"
                            src={`/entrance_ppreview_demo?brandColor=${encodeURIComponent(debouncedBrandColor)}&accentColor=${encodeURIComponent(debouncedAccentColor)}&brandLogo=${blobUrl ? encodeURIComponent(blobUrl) : logo ? encodeURIComponent(logo) : ""}&welcomeMessage=${encodeURIComponent(debouncedWelcomeMessage)}`}
                            className="absolute left-0 top-0 h-full w-full origin-top-left scale-50 overflow-hidden rounded-b-lg border-0 bg-white"
                            style={{
                              width: "200%",
                              height: "200%",
                              pointerEvents: "none",
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            {/* Preview Mode Info */}
            {/* <div className="mt-6 flex justify-center">
              <div className="w-full max-w-[698px] space-y-2 rounded-lg border border-border bg-card p-4">
                <h4 className="text-sm font-semibold text-foreground">
                  Preview Mode
                </h4>
                <p className="text-sm text-muted-foreground">
                  Changes will be reflected in real-time as you adjust settings.
                </p>
              </div>
            </div> */}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
