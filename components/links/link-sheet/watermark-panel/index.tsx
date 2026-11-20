import React, { useEffect, useState } from "react";

import { motion } from "motion/react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { FADE_IN_ANIMATION_SETTINGS } from "@/lib/constants";
import { WatermarkConfig, WatermarkConfigSchema } from "@/lib/types";

import WatermarkPreview from "./watermark-preview";

const PREVIEW_PLACEHOLDER_TEXT = "Confidential {{email}}";

interface WatermarkConfigSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialConfig: Partial<WatermarkConfig>;
  onSave: (config: WatermarkConfig) => void;
}

export default function WatermarkConfigSheet({
  isOpen,
  onOpenChange,
  initialConfig,
  onSave,
}: WatermarkConfigSheetProps) {
  const [formValues, setFormValues] =
    useState<Partial<WatermarkConfig>>(initialConfig);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const previewConfig: WatermarkConfig = {
    text: formValues.text?.trim() ? formValues.text : PREVIEW_PLACEHOLDER_TEXT,
    isTiled: formValues.isTiled ?? false,
    position: formValues.position ?? "middle-center",
    rotation: formValues.rotation ?? 45,
    color: formValues.color ?? "#000000",
    fontSize: formValues.fontSize ?? 24,
    opacity: formValues.opacity ?? 0.5,
  };

  useEffect(() => {
    setFormValues(initialConfig);
  }, [initialConfig]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormValues((prevValues) => ({
      ...prevValues,
      [name]: value,
    }));
  };

  const validateAndSave = () => {
    try {
      const validatedData = WatermarkConfigSchema.parse(formValues);
      onSave(validatedData);
      setErrors({});
      onOpenChange(false);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            fieldErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(fieldErrors);
      }
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full flex-col sm:max-w-6xl">
        <SheetHeader>
          <SheetTitle>Watermark Configuration</SheetTitle>
          <SheetDescription>
            Configure the watermark settings for your document.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:gap-8">
          {/* Settings column */}
          <ScrollArea className="min-h-0 flex-1 lg:w-[360px] lg:flex-none lg:pr-4">
          <motion.div
            className="relative mt-4 space-y-3"
            {...FADE_IN_ANIMATION_SETTINGS}
          >
            <div className="flex w-full flex-col items-start gap-6 overflow-x-visible pb-4 pt-0">
              <div className="w-full space-y-2">
                <Label htmlFor="watermark-text">Watermark Text</Label>
                <Input
                  id="watermark-text"
                  type="text"
                  name="text"
                  placeholder="e.g. Confidential {{email}} {{date}}"
                  value={formValues.text || ""}
                  onChange={handleInputChange}
                  className="focus:ring-inset"
                />
                <div className="space-x-1 space-y-1">
                  {["email", "date", "time", "link", "ipAddress"].map(
                    (item) => (
                      <Button
                        key={item}
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-3xl bg-muted text-sm font-normal text-foreground/80 hover:bg-muted/70"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setFormValues((prevValues) => ({
                            ...prevValues,
                            text: `${prevValues.text || ""}{{${item}}}`,
                          }));
                        }}
                      >{`{{${item}}}`}</Button>
                    ),
                  )}
                </div>
                {errors.text && <p className="text-red-500">{errors.text}</p>}
              </div>

              <div className="w-full space-y-2">
                <div className="relative flex items-center space-x-2">
                  <Checkbox
                    id="watermark-tiled"
                    checked={formValues.isTiled}
                    onCheckedChange={(checked) => {
                      setFormValues((prevValues) => ({
                        ...prevValues,
                        isTiled: checked === true,
                      }));
                    }}
                    className="mt-0.5 border border-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-300 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-white data-[state=checked]:bg-black data-[state=checked]:text-white"
                  />
                  <Label htmlFor="watermark-tiled">Tiled</Label>
                </div>
                {errors.isTiled && (
                  <p className="text-red-500">{errors.isTiled}</p>
                )}
              </div>

              <div className="w-full space-y-2">
                <Label htmlFor="watermark-position">Position</Label>
                <Select
                  name="position"
                  value={formValues.position}
                  disabled={formValues.isTiled}
                  onValueChange={(value) => {
                    setFormValues({
                      ...formValues,
                      position: value as WatermarkConfig["position"],
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select position" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="top-left">Top Left</SelectItem>
                    <SelectItem value="top-center">Top Center</SelectItem>
                    <SelectItem value="top-right">Top Right</SelectItem>
                    <SelectItem value="middle-left">Middle Left</SelectItem>
                    <SelectItem value="middle-center">Middle Center</SelectItem>
                    <SelectItem value="middle-right">Middle Right</SelectItem>
                    <SelectItem value="bottom-left">Bottom Left</SelectItem>
                    <SelectItem value="bottom-center">Bottom Center</SelectItem>
                    <SelectItem value="bottom-right">Bottom Right</SelectItem>
                  </SelectContent>
                </Select>
                {errors.position && (
                  <p className="text-red-500">{errors.position}</p>
                )}
              </div>

              <div className="w-full space-y-2">
                <Label htmlFor="watermark-rotation">Rotation</Label>
                <Select
                  name="rotation"
                  value={formValues.rotation?.toString()}
                  onValueChange={(value) => {
                    setFormValues({
                      ...formValues,
                      rotation: parseInt(value) as WatermarkConfig["rotation"],
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select rotation" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0°</SelectItem>
                    <SelectItem value="30">30°</SelectItem>
                    <SelectItem value="45">45°</SelectItem>
                    <SelectItem value="90">90°</SelectItem>
                    <SelectItem value="180">180°</SelectItem>
                  </SelectContent>
                </Select>
                {errors.rotation && (
                  <p className="text-red-500">{errors.rotation}</p>
                )}
              </div>

              <div className="w-full space-y-2">
                <Label htmlFor="watermark-color">Text Color</Label>
                <div className="ml-0.5 mr-0.5 flex space-x-1">
                  <Popover>
                    <PopoverTrigger>
                      <div
                        className="h-9 w-9 cursor-pointer rounded-md shadow-sm ring-1 ring-muted-foreground hover:ring-1 hover:ring-gray-300 focus:ring-inset"
                        style={{ backgroundColor: formValues.color }}
                      />
                    </PopoverTrigger>
                    <PopoverContent>
                      <HexColorPicker
                        color={formValues.color || ""}
                        onChange={(value) => {
                          setFormValues({
                            ...formValues,
                            color: value as WatermarkConfig["color"],
                          });
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  <HexColorInput
                    className="flex w-full rounded-md border border-input bg-white text-foreground placeholder-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-inset focus:ring-muted-foreground dark:border-gray-500 dark:bg-gray-800 focus:dark:bg-transparent sm:text-sm"
                    color={formValues.color || ""}
                    onChange={(value) => {
                      setFormValues({
                        ...formValues,
                        color: value as WatermarkConfig["color"],
                      });
                    }}
                    prefixed
                  />
                </div>
                {errors.color && <p className="text-red-500">{errors.color}</p>}
              </div>

              <div className="flex w-full space-x-4">
                <div className="w-full space-y-2">
                  <Label htmlFor="watermark-fontSize">Font Size</Label>
                  <Input
                    id="watermark-fontSize"
                    type="number"
                    name="fontSize"
                    step="4"
                    value={formValues.fontSize}
                    onChange={(e) => {
                      setFormValues({
                        ...formValues,
                        fontSize: parseInt(
                          e.target.value,
                        ) as WatermarkConfig["fontSize"],
                      });
                    }}
                    className="focus:ring-inset"
                  />
                  {errors.fontSize && (
                    <p className="text-red-500">{errors.fontSize}</p>
                  )}
                </div>
                <div className="w-full space-y-2">
                  <Label htmlFor="watermark-opacity">Transparency</Label>
                  <Select
                    name="opacity"
                    value={formValues.opacity?.toString()}
                    onValueChange={(value) => {
                      setFormValues({
                        ...formValues,
                        opacity: parseFloat(
                          value,
                        ) as WatermarkConfig["opacity"],
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select transparency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">No transparency</SelectItem>
                      <SelectItem value="0.25">75%</SelectItem>
                      <SelectItem value="0.5">50%</SelectItem>
                      <SelectItem value="0.75">25%</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.opacity && (
                    <p className="text-red-500">{errors.opacity}</p>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
          </ScrollArea>

          {/* Separator */}
          <div className="hidden lg:block lg:w-px lg:self-stretch lg:bg-border" />

          {/* Preview column */}
          <div className="min-h-0 flex-1 overflow-y-auto lg:pl-2">
            <WatermarkPreview config={previewConfig} />
          </div>
        </div>

        <SheetFooter className="flex-shrink-0">
          <Button onClick={validateAndSave}>Save Watermark</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
