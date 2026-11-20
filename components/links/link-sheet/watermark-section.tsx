import { useEffect, useState } from "react";

import { LinkPreset } from "@prisma/client";
import { SettingsIcon } from "lucide-react";
import { motion } from "motion/react";

import { FADE_IN_ANIMATION_SETTINGS } from "@/lib/constants";
import { WatermarkConfig } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { DEFAULT_LINK_TYPE } from ".";
import LinkItem from "./link-item";
import { LinkUpgradeOptions } from "./link-options";
import WatermarkConfigSheet from "./watermark-panel";

export default function WatermarkSection({
  data,
  setData,
  isAllowed,
  handleUpgradeStateChange,
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
  presets: LinkPreset | null;
}) {
  const { enableWatermark, watermarkConfig } = data;
  const [enabled, setEnabled] = useState<boolean>(false);
  const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);

  useEffect(() => {
    setEnabled(enableWatermark);
  }, [enableWatermark]);

  useEffect(() => {
    if (isAllowed && presets?.enableWatermark && presets?.watermarkConfig) {
      setEnabled(true);
      setData((prevData) => ({
        ...prevData,
        enableWatermark: true,
        watermarkConfig: presets.watermarkConfig
          ? (JSON.parse(presets.watermarkConfig as string) as WatermarkConfig)
          : null,
      }));
    }
  }, [presets, isAllowed]);

  const initialconfig: WatermarkConfig = {
    text: watermarkConfig?.text ?? "",
    isTiled: watermarkConfig?.isTiled ?? false,
    opacity: watermarkConfig?.opacity ?? 0.5,
    color: watermarkConfig?.color ?? "#000000",
    fontSize: watermarkConfig?.fontSize ?? 24,
    rotation: watermarkConfig?.rotation ?? 45,
    position: watermarkConfig?.position ?? "middle-center",
  };

  const handleWatermarkToggle = () => {
    const updatedWatermark = !enabled;

    setData({
      ...data,
      enableWatermark: updatedWatermark,
      watermarkConfig: updatedWatermark
        ? watermarkConfig || initialconfig
        : null,
    });
    setEnabled(updatedWatermark);
  };

  const handleConfigSave = (config: WatermarkConfig) => {
    setData({
      ...data,
      watermarkConfig: config,
    });
  };

  return (
    <div className="pb-5">
      <LinkItem
        title="Dynamic watermarking"
        link="https://www.papermark.com/help/article/document-watermark"
        tooltipContent="Add a dynamic watermark to your content."
        enabled={enabled}
        action={handleWatermarkToggle}
        isAllowed={isAllowed}
        requiredPlan="datarooms"
        upgradeAction={() =>
          handleUpgradeStateChange({
            state: true,
            trigger: "link_sheet_watermark_section",
            plan: "Data Rooms",
            highlightItem: ["watermark"],
          })
        }
      />

      {enabled && (
        <motion.div
          className="relative mt-4 space-y-3"
          {...FADE_IN_ANIMATION_SETTINGS}
        >
          <div className="flex w-full flex-col items-start gap-6 overflow-x-visible pt-0">
            <div className="w-full space-y-2">
              <Label htmlFor="watermark-text">Watermark Text</Label>
              <Input
                id="watermark-text"
                type="text"
                name="text"
                placeholder="e.g. Confidential {{email}} {{date}}"
                value={watermarkConfig?.text ?? ""}
                required={enabled}
                onChange={(e) => {
                  setData((prevData) => ({
                    ...prevData,
                    watermarkConfig: {
                      ...(prevData.watermarkConfig || initialconfig),
                      text: e.target.value,
                    },
                  }));
                }}
                className="focus:ring-inset"
              />
              <div className="space-x-1 space-y-1">
                {["email", "date", "time", "link", "ipAddress"].map((item) => (
                  <Button
                    key={item}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-3xl bg-muted text-sm font-normal text-foreground/80 hover:bg-muted/70"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setData((prevData) => ({
                        ...prevData,
                        watermarkConfig: {
                          ...(prevData.watermarkConfig || initialconfig),
                          text: `${prevData.watermarkConfig?.text || ""} {{${item}}}`,
                        },
                      }));
                    }}
                  >{`{{${item}}}`}</Button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-2 flex w-full items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {initialconfig.isTiled ? `tiled` : initialconfig.position},{" "}
              {initialconfig.rotation}º, {initialconfig.fontSize}px,{" "}
              {initialconfig.color.toUpperCase()},{" "}
              {(1 - initialconfig.opacity) * 100}% transparent
            </p>
            <Button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsConfigOpen(true);
              }}
              variant="outline"
              className="h-8"
              size="sm"
            >
              <SettingsIcon className="mr-2 h-4 w-4" />
              Configure
            </Button>
          </div>
        </motion.div>
      )}

      <WatermarkConfigSheet
        isOpen={isConfigOpen}
        onOpenChange={setIsConfigOpen}
        initialConfig={initialconfig}
        onSave={handleConfigSave}
      />
    </div>
  );
}
