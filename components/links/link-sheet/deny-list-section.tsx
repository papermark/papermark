import { useEffect, useMemo, useState } from "react";

import { LinkPreset } from "@prisma/client";
import { motion } from "motion/react";

import { FADE_IN_ANIMATION_SETTINGS } from "@/lib/constants";
import { validateList } from "@/lib/utils";

import { Textarea } from "@/components/ui/textarea";

import { DEFAULT_LINK_TYPE } from ".";
import LinkItem from "./link-item";
import { LinkUpgradeOptions } from "./link-options";

export default function DenyListSection({
  data,
  setData,
  isAllowed,
  handleUpgradeStateChange,
  presets,
  setValidationError,
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
  setValidationError?: (key: string, errors: string[]) => void;
}) {
  const { emailProtected, denyList } = data;
  // Initialize enabled state based on whether denyList is not null and not empty
  const [enabled, setEnabled] = useState<boolean>(
    !!denyList && denyList.length > 0,
  );
  const [denyListInput, setDenyListInput] = useState<string>(
    denyList?.join("\n") || "",
  );

  const validation = useMemo(
    () => validateList(denyListInput, "both"),
    [denyListInput],
  );

  useEffect(() => {
    if (!setValidationError) return;
    if (enabled && emailProtected) {
      setValidationError("denyList", validation.invalid);
    } else {
      setValidationError("denyList", []);
    }
  }, [enabled, emailProtected, validation.invalid, setValidationError]);

  useEffect(() => {
    return () => {
      setValidationError?.("denyList", []);
    };
  }, [setValidationError]);

  useEffect(() => {
    if (!emailProtected && enabled) {
      setEnabled(false);
      setData((prevData) => ({
        ...prevData,
        denyList: [],
      }));
    }
  }, [emailProtected, enabled, setData]);

  useEffect(() => {
    if (isAllowed && presets?.denyList && presets.denyList.length > 0) {
      setEnabled(true);
      setDenyListInput(presets.denyList?.join("\n") || "");
    }
  }, [presets, isAllowed]);

  const handleEnableDenyList = () => {
    const updatedEnabled = !enabled;
    setEnabled(updatedEnabled);

    if (updatedEnabled) {
      setData((prevData) => ({
        ...prevData,
        denyList: updatedEnabled ? validateList(denyListInput).valid : [],
        emailAuthenticated: true, // Turn on email authentication
        emailProtected: true, // Turn on email protection
      }));
    } else {
      setData((prevData) => ({
        ...prevData,
        denyList: [],
      }));
    }
  };

  const handleDenyListChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const updatedDenyListInput = event.target.value;
    setDenyListInput(updatedDenyListInput);

    if (emailProtected && enabled) {
      setData((prevData) => ({
        ...prevData,
        denyList: validateList(updatedDenyListInput).valid,
      }));
    }
  };

  return (
    <div className="pb-5">
      <div className="flex flex-col space-y-4">
        <LinkItem
          title="Block specified viewers"
          tooltipContent="Prevent certain users from accessing the content. Enter blocked emails or domains."
          enabled={enabled}
          link="https://www.papermark.com/help/article/block-list"
          action={handleEnableDenyList}
          isAllowed={isAllowed}
          requiredPlan="business"
          upgradeAction={() =>
            handleUpgradeStateChange({
              state: true,
              trigger: "link_sheet_denylist_section",
              plan: "Business",
              highlightItem: ["allow-block"],
            })
          }
        />

        {enabled && (
          <motion.div
            className="mt-1 block w-full"
            {...FADE_IN_ANIMATION_SETTINGS}
          >
            <Textarea
              className="focus:ring-inset"
              rows={5}
              placeholder={`Enter blocked emails/domains separated by comma, semicolon, or new line, e.g.
marc@papermark.com
@example.org`}
              value={denyListInput}
              onChange={handleDenyListChange}
              aria-invalid={validation.invalid.length > 0}
            />
            {validation.invalid.length > 0 ? (
              <p className="mt-2 text-xs text-destructive">
                The following entries are not valid emails or domains and must
                be fixed before saving:{" "}
                <span className="font-medium">
                  {validation.invalid.slice(0, 5).join(", ")}
                  {validation.invalid.length > 5
                    ? `, and ${validation.invalid.length - 5} more`
                    : ""}
                </span>
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Separate multiple entries with a comma, semicolon, or new line.
                Use <code>@example.org</code> to block a whole domain.
              </p>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
