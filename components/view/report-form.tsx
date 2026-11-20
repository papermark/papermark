import { useState } from "react";

import { Flag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { ButtonTooltip } from "../ui/tooltip";

// Keeps the legacy `not-working` radio value working with the camelCased
// translation key (`types.notWorking`) without changing the API contract.
const ABUSE_TYPE_TO_TRANSLATION_KEY: Record<string, string> = {
  spam: "spam",
  malware: "malware",
  copyright: "copyright",
  harmful: "harmful",
  "not-working": "notWorking",
  other: "other",
};

export default function ReportForm({
  linkId,
  documentId,
  viewId,
}: {
  linkId: string | undefined;
  documentId: string | undefined;
  viewId: string | undefined;
}) {
  const { t } = useTranslation("viewer");
  const [abuseType, setAbuseType] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  enum AbuseTypeEnum {
    "spam" = 1,
    "malware" = 2,
    "copyright" = 3,
    "harmful" = 4,
    "not-working" = 5,
    "other" = 6,
  }

  const handleSubmit = async () => {
    if (!abuseType) {
      toast.error(t("report.selectTypeError", "Please select an abuse type."));
      return;
    }

    const abuseTypeEnum =
      AbuseTypeEnum[abuseType as keyof typeof AbuseTypeEnum]; // Convert string to enum number

    setLoading(true);

    const response = await fetch("/api/report", {
      method: "POST",
      body: JSON.stringify({
        linkId: linkId,
        documentId: documentId,
        viewId: viewId,
        abuseType: abuseTypeEnum, // Send the numeric value of the abuse type
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const { message } = await response.json();
      toast.error(message);
      setOpen(false);
      setLoading(false);
      return;
    }

    toast.success(t("report.successToast", "Report submitted successfully"));
    setOpen(false);
    setLoading(false);
  };

  const triggerLabel = t("report.trigger", "Report abuse");

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <ButtonTooltip
          content={triggerLabel}
          sideOffset={8}
          className="border-gray-800"
        >
          <PopoverTrigger asChild>
            <Button
              className="h-8 w-8 bg-gray-900 text-xs text-gray-300 hover:bg-gray-900/80 hover:text-gray-50 sm:h-10 sm:w-10 sm:text-sm"
              size="icon"
              title={triggerLabel}
            >
              <Flag className="size-3 sm:size-4" />
            </Button>
          </PopoverTrigger>
        </ButtonTooltip>
        <PopoverContent className="w-auto" align="end">
          <div className="flex max-w-xs flex-col gap-4">
            <div className="space-y-2">
              <h4 className="font-medium leading-none">{t("report.title", "Report an issue")}</h4>
              <p className="text-sm text-muted-foreground">
                {t("report.description", "See something inappropriate? We will take a look and, when appropriate, take action.")}
              </p>
            </div>
            <div className="flex flex-col space-y-4">
              <RadioGroup
                value={abuseType}
                onValueChange={setAbuseType}
                className="grid gap-2"
              >
                {Object.entries(ABUSE_TYPE_TO_TRANSLATION_KEY).map(
                  ([value, key]) => (
                    <div key={value} className="flex items-center space-x-2">
                      <RadioGroupItem value={value} id={value} />
                      <Label htmlFor={value} className="font-normal">
                        {t(`report.types.${key}`)}
                      </Label>
                    </div>
                  ),
                )}
              </RadioGroup>
              <Button
                onClick={handleSubmit}
                disabled={!abuseType}
                loading={loading}
                size="sm"
              >
                {t("report.submit", "Submit Report")}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
