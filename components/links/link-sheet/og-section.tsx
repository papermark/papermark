import { ChangeEvent, useCallback, useEffect, useState } from "react";

import { LinkPreset } from "@prisma/client";
import { Label } from "@radix-ui/react-label";
import { Upload as ArrowUpTrayIcon, PlusIcon } from "lucide-react";
import { motion } from "motion/react";

import { FADE_IN_ANIMATION_SETTINGS } from "@/lib/constants";
import { cn, fetcher, validateImageDimensions } from "@/lib/utils";
import { resizeImage } from "@/lib/utils/resize-image";

import { Input } from "@/components/ui/input";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { Textarea } from "@/components/ui/textarea";

import { DEFAULT_LINK_TYPE } from ".";
import LinkItem from "./link-item";
import { LinkUpgradeOptions } from "./link-options";

export default function OGSection({
  data,
  setData,
  isAllowed,
  handleUpgradeStateChange,
  editLink,
  presets,
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
  editLink: boolean;
  presets: LinkPreset | null;
}) {
  const {
    enableCustomMetatag,
    metaTitle,
    metaDescription,
    metaImage,
    metaFavicon,
  } = data;

  const [enabled, setEnabled] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [faviconFileError, setFaviconFileError] = useState<string | null>(null);
  const [faviconDragActive, setFaviconDragActive] = useState(false);

  const onChangePicture = useCallback(
    async (e: any) => {
      setFileError(null);
      const file = e.target.files[0];
      if (file) {
        if (file.size / 1024 / 1024 > 5) {
          setFileError("File size too big (max 5MB)");
        } else if (file.type !== "image/png" && file.type !== "image/jpeg") {
          setFileError("File type not supported (.png or .jpg only)");
        } else {
          const image = await resizeImage(file);
          setData((prev) => ({
            ...prev,
            metaImage: image,
          }));
        }
      }
    },
    [setData],
  );

  useEffect(() => {
    setEnabled(enableCustomMetatag);
  }, [enableCustomMetatag]);

  const handleCustomMetatag = async () => {
    const updatedCustomMetatag = !enabled;

    setData({ ...data, enableCustomMetatag: updatedCustomMetatag });
    setEnabled(updatedCustomMetatag);
  };

  const resetMetatags = () => {
    setData({
      ...data,
      metaImage: presets?.metaImage ?? null,
      metaTitle: presets?.metaTitle ?? null,
      metaDescription: presets?.metaDescription ?? null,
    });
  };

  const onChangeFavicon = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      setFaviconFileError(null);
      const file = e.target.files && e.target.files[0];
      if (file) {
        if (file.size / 1024 / 1024 > 1) {
          setFaviconFileError("File size too big (max 1MB)");
        } else if (
          file.type !== "image/png" &&
          file.type !== "image/x-icon" &&
          file.type !== "image/svg+xml"
        ) {
          setFaviconFileError(
            "File type not supported (.png, .ico, .svg only)",
          );
        } else {
          const image = await resizeImage(file, {
            width: 36,
            height: 36,
            quality: 1,
          });
          const isValidDimensions = await validateImageDimensions(
            image,
            16,
            48,
          );
          if (!isValidDimensions) {
            setFaviconFileError(
              "Image dimensions must be between 16x16 and 48x48",
            );
          } else {
            setData((prev) => ({
              ...prev,
              metaFavicon: image,
            }));
          }
        }
      }
    },
    [setData],
  );

  return (
    <div className="pb-5">
      <LinkItem
        tooltipContent="Customize how your links look when shared."
        title="Custom link preview"
        link="https://www.papermark.com/help/article/change-social-media-cards"
        enabled={enableCustomMetatag}
        action={handleCustomMetatag}
        isAllowed={isAllowed}
        requiredPlan="Business"
        upgradeAction={() =>
          handleUpgradeStateChange({
            state: true,
            trigger: "link_sheet_og_section",
            plan: "Business",
            highlightItem: ["custom-social-cards"],
          })
        }
        resetAction={resetMetatags}
      />

      {enabled && (
        <motion.div
          className="relative mt-4 space-y-3 rounded-md shadow-sm"
          {...FADE_IN_ANIMATION_SETTINGS}
        >
          <div>
            <div className="flex items-center justify-between">
              <p className="block text-sm font-medium text-foreground">Image</p>
              {fileError ? (
                <p className="text-sm text-red-500">{fileError}</p>
              ) : null}
            </div>
            <label
              htmlFor="image"
              className="group relative mt-1 flex aspect-[1200/630] h-fit cursor-pointer flex-col items-center justify-center rounded-md border border-input bg-white shadow-sm transition-all hover:border-muted-foreground hover:bg-gray-50 hover:ring-muted-foreground dark:bg-gray-800 hover:dark:bg-transparent"
            >
              {false && (
                <div className="absolute z-[5] flex h-full w-full items-center justify-center rounded-md bg-white">
                  <LoadingSpinner />
                </div>
              )}
              <div
                className="absolute z-[5] h-full w-full rounded-md"
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
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragActive(false);
                  setFileError(null);
                  const file = e.dataTransfer.files && e.dataTransfer.files[0];
                  if (file) {
                    if (file.size / 1024 / 1024 > 5) {
                      setFileError("File size too big (max 5MB)");
                    } else if (
                      file.type !== "image/png" &&
                      file.type !== "image/jpeg" &&
                      file.type !== "image/jpg"
                    ) {
                      setFileError(
                        "File type not supported (.png or .jpg only)",
                      );
                    } else {
                      const image = await resizeImage(file);
                      setData((prev) => ({
                        ...prev,
                        metaImage: image,
                      }));
                    }
                  }
                }}
              />
              <div
                className={cn(
                  "absolute z-[3] flex h-full w-full flex-col items-center justify-center rounded-md transition-all",
                  dragActive &&
                    "cursor-copy border-2 border-black bg-gray-50 opacity-100 dark:bg-transparent",
                  metaImage
                    ? "opacity-0 group-hover:opacity-100"
                    : "group-hover:bg-gray-50 group-hover:dark:bg-transparent",
                )}
              >
                <ArrowUpTrayIcon
                  className={cn(
                    "h-7 w-7 text-gray-500 transition-all duration-75 group-hover:scale-110 group-active:scale-95",
                    dragActive ? "scale-110" : "scale-100",
                  )}
                />
                <p className="mt-2 text-center text-sm text-gray-500">
                  Drag and drop or click to upload.
                </p>
                <p className="mt-2 text-center text-sm text-gray-500">
                  Recommended: 1200 x 630 pixels (max 5MB)
                </p>
                <span className="sr-only">OG image upload</span>
              </div>
              {metaImage && (
                <img
                  src={metaImage}
                  alt="Preview"
                  className="h-full w-full rounded-md object-cover"
                />
              )}
            </label>
            <div className="mt-1 flex rounded-md shadow-sm">
              <input
                id="image"
                name="image"
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                className="sr-only"
                onChange={onChangePicture}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="faviconIcon">
                <p className="block text-sm font-medium text-foreground">
                  Favicon Icon{" "}
                  <span className="text-sm italic text-muted-foreground">
                    (max 1 MB)
                  </span>
                </p>
              </Label>
              {faviconFileError ? (
                <p className="text-sm text-red-500">{faviconFileError}</p>
              ) : null}
            </div>
            <label
              htmlFor="faviconIcon"
              className="group relative mt-1 flex size-14 cursor-pointer flex-col items-center justify-center rounded-md border border-gray-300 bg-white shadow-sm transition-all hover:bg-gray-50"
              style={{
                backgroundImage:
                  "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(135deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(135deg, transparent 75%, #ccc 75%)",
                backgroundSize: "20px 20px",
                backgroundPosition: "0 0, 10px 0, 10px -10px, 0px 10px",
              }}
            >
              {false && (
                <div className="absolute z-[5] flex h-full w-full items-center justify-center rounded-md bg-white">
                  <LoadingSpinner />
                </div>
              )}
              <div
                className="absolute z-[5] h-full w-full rounded-md"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setFaviconDragActive(true);
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setFaviconDragActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setFaviconDragActive(false);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setFaviconDragActive(false);
                  setFaviconFileError(null);
                  const file = e.dataTransfer.files && e.dataTransfer.files[0];
                  if (file) {
                    if (file.size / 1024 / 1024 > 1) {
                      setFaviconFileError("File size too big (max 1MB)");
                    } else if (
                      file.type !== "image/png" &&
                      file.type !== "image/x-icon" &&
                      file.type !== "image/svg+xml"
                    ) {
                      setFaviconFileError(
                        "File type not supported (.png, .ico, .svg only)",
                      );
                    } else {
                      const image = await resizeImage(file, {
                        width: 36,
                        height: 36,
                        quality: 1,
                      });
                      const isValidDimensions = await validateImageDimensions(
                        image,
                        16,
                        48,
                      );
                      if (!isValidDimensions) {
                        setFaviconFileError(
                          "Image dimensions must be between 16x16 and 48x48",
                        );
                      } else {
                        setData((prev) => ({
                          ...prev,
                          metaFavicon: image,
                        }));
                      }
                    }
                  }
                }}
              />
              <div
                className={`${
                  faviconDragActive
                    ? "cursor-copy border-2 border-black bg-gray-50 opacity-100"
                    : ""
                } absolute z-[3] flex h-full w-full flex-col items-center justify-center rounded-md bg-white transition-all ${
                  metaFavicon
                    ? "opacity-0 group-hover:opacity-100"
                    : "group-hover:bg-gray-50"
                }`}
              >
                <PlusIcon
                  className={`${
                    faviconDragActive ? "scale-110" : "scale-100"
                  } h-7 w-7 text-gray-500 transition-all duration-75 group-hover:scale-110 group-active:scale-95`}
                />
                <span className="sr-only">OG image upload</span>
              </div>
              {metaFavicon && (
                <img
                  src={metaFavicon}
                  alt="Preview"
                  className="h-full w-full rounded-md object-contain"
                />
              )}
            </label>
            <div className="mt-1 hidden rounded-md shadow-sm">
              <input
                id="faviconIcon"
                name="favicon"
                type="file"
                accept="image/png,image/x-icon,image/svg+xml"
                className="sr-only"
                onChange={onChangeFavicon}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <p className="block text-sm font-medium text-foreground">Title</p>
              <p className="text-sm text-muted-foreground">
                {metaTitle?.length || 0}/120
              </p>
            </div>
            <div className="relative mt-1 flex rounded-md shadow-sm">
              {false && (
                <div className="absolute flex h-full w-full items-center justify-center rounded-md border border-gray-300 bg-white">
                  <LoadingSpinner />
                </div>
              )}
              <Input
                name="title"
                id="title"
                maxLength={120}
                className="focus:ring-inset"
                placeholder={`Papermark - open-source document sharing infrastructure.`}
                value={metaTitle || ""}
                onChange={(e) => {
                  setData({ ...data, metaTitle: e.target.value });
                }}
                aria-invalid="true"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="block text-sm font-medium text-foreground">
                Description
              </p>
              <p className="text-sm text-muted-foreground">
                {metaDescription?.length || 0}/240
              </p>
            </div>
            <div className="relative mt-1 flex rounded-md shadow-sm">
              {false && (
                <div className="absolute flex h-full w-full items-center justify-center rounded-md border border-gray-300 bg-white">
                  <LoadingSpinner />
                </div>
              )}
              <Textarea
                name="description"
                id="description"
                rows={3}
                maxLength={240}
                className="focus:ring-inset"
                placeholder={`Papermark is an open-source document sharing infrastructure for modern teams.`}
                value={metaDescription || ""}
                onChange={(e) => {
                  setData({
                    ...data,
                    metaDescription: e.target.value,
                  });
                }}
                aria-invalid="true"
              />
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
