import { useEffect, useMemo, useState } from "react";

import { LinkPreset } from "@prisma/client";
import { CheckIcon, UsersIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";

import { FADE_IN_ANIMATION_SETTINGS } from "@/lib/constants";
import useVisitorGroups from "@/lib/swr/use-visitor-groups";
import { validateList } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

import { DEFAULT_LINK_TYPE } from ".";
import LinkItem from "./link-item";
import { LinkUpgradeOptions } from "./link-options";

export default function AllowListSection({
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
  const { emailProtected, allowList, visitorGroupIds } = data;
  const { visitorGroups } = useVisitorGroups();

  // Initialize enabled state based on whether allowList is not null and not empty
  // or if visitor groups are selected
  const [enabled, setEnabled] = useState<boolean>(
    (!!allowList && allowList.length > 0) ||
      (!!visitorGroupIds && visitorGroupIds.length > 0),
  );
  const [allowListInput, setAllowListInput] = useState<string>(
    allowList?.join("\n") || "",
  );

  const validation = useMemo(
    () => validateList(allowListInput, "both"),
    [allowListInput],
  );

  useEffect(() => {
    if (!setValidationError) return;
    if (enabled && emailProtected) {
      setValidationError("allowList", validation.invalid);
    } else {
      setValidationError("allowList", []);
    }
  }, [enabled, emailProtected, validation.invalid, setValidationError]);

  useEffect(() => {
    return () => {
      setValidationError?.("allowList", []);
    };
  }, [setValidationError]);

  useEffect(() => {
    if (!emailProtected && enabled) {
      setEnabled(false);
      setData((prevData) => ({
        ...prevData,
        allowList: [],
        visitorGroupIds: [],
      }));
    }
  }, [emailProtected, enabled, setData]);

  useEffect(() => {
    if (isAllowed && presets?.allowList && presets.allowList.length > 0) {
      setEnabled(true);
      setAllowListInput(presets.allowList.join("\n") || "");
    }
  }, [presets, isAllowed]);

  const handleEnableAllowList = () => {
    const updatedEnabled = !enabled;
    setEnabled(updatedEnabled);

    if (updatedEnabled) {
      setData((prevData) => ({
        ...prevData,
        allowList: updatedEnabled
          ? validateList(allowListInput).valid
          : [],
        emailAuthenticated: true, // Turn on email authentication
        emailProtected: true, // Turn on email protection
      }));
    } else {
      setData((prevData) => ({
        ...prevData,
        allowList: [],
        visitorGroupIds: [],
      }));
    }
  };

  const handleAllowListChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const updatedAllowListInput = event.target.value;
    setAllowListInput(updatedAllowListInput);

    if (emailProtected && enabled) {
      setData((prevData) => ({
        ...prevData,
        allowList: validateList(updatedAllowListInput).valid,
      }));
    }
  };

  const toggleVisitorGroup = (groupId: string) => {
    setData((prevData) => {
      const currentIds = prevData.visitorGroupIds || [];
      const newIds = currentIds.includes(groupId)
        ? currentIds.filter((id) => id !== groupId)
        : [...currentIds, groupId];
      return { ...prevData, visitorGroupIds: newIds };
    });
  };

  const removeVisitorGroup = (groupId: string) => {
    setData((prevData) => ({
      ...prevData,
      visitorGroupIds: (prevData.visitorGroupIds || []).filter(
        (id) => id !== groupId,
      ),
    }));
  };

  const selectedGroups =
    visitorGroups?.filter((g) => visitorGroupIds?.includes(g.id)) || [];

  return (
    <div className="pb-5">
      <div className="flex flex-col space-y-4">
        <LinkItem
          title="Allow specified viewers"
          link="https://www.papermark.com/help/article/allow-list"
          tooltipContent={`Restrict access to a selected group of viewers. Enter allowed emails or domains${visitorGroups && visitorGroups.length > 0 ? ", or select visitor groups" : ""}.`}
          enabled={enabled}
          isAllowed={isAllowed}
          action={handleEnableAllowList}
          requiredPlan="business"
          upgradeAction={() =>
            handleUpgradeStateChange({
              state: true,
              trigger: "link_sheet_allowlist_section",
              plan: "Business",
              highlightItem: ["allow-block"],
            })
          }
        />

        {enabled && (
          <motion.div
            className="mt-1 block w-full space-y-3"
            {...FADE_IN_ANIMATION_SETTINGS}
          >
            {/* Visitor Groups Selector */}
            {visitorGroups && visitorGroups.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <UsersIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">
                    Visitor Groups
                  </span>
                </div>

                {/* Selected groups as badges */}
                {selectedGroups.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {selectedGroups.map((group) => (
                      <Badge
                        key={group.id}
                        variant="secondary"
                        className="gap-1 pr-1"
                      >
                        {group.name}
                        <span className="text-muted-foreground">
                          ({group.emails.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => removeVisitorGroup(group.id)}
                          className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                        >
                          <XIcon className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-start text-muted-foreground"
                    >
                      <UsersIcon className="mr-2 h-3.5 w-3.5" />
                      {selectedGroups.length > 0
                        ? `${selectedGroups.length} group${selectedGroups.length > 1 ? "s" : ""} selected`
                        : "Select visitor groups..."}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-1" align="start">
                    <div className="max-h-60 overflow-y-auto">
                      {visitorGroups.map((group) => {
                        const isSelected = visitorGroupIds?.includes(group.id);
                        return (
                          <button
                            key={group.id}
                            type="button"
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                            onClick={() => toggleVisitorGroup(group.id)}
                          >
                            <div
                              className={`flex h-4 w-4 items-center justify-center rounded-sm border ${
                                isSelected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-muted-foreground/30"
                              }`}
                            >
                              {isSelected && (
                                <CheckIcon className="h-3 w-3" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">
                                {group.name}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {group.emails.length}{" "}
                                {group.emails.length === 1
                                  ? "entry"
                                  : "entries"}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>

                <div className="my-2 flex items-center gap-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">
                    plus individual emails
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              </div>
            )}

            <Textarea
              className="focus:ring-inset"
              rows={5}
              placeholder={`Enter allowed emails/domains separated by comma, semicolon, or new line, e.g.
marc@papermark.com
@example.org`}
              value={allowListInput}
              onChange={handleAllowListChange}
              aria-invalid={validation.invalid.length > 0}
            />
            {validation.invalid.length > 0 ? (
              <p className="text-xs text-destructive">
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
              <p className="text-xs text-muted-foreground">
                Separate multiple entries with a comma, semicolon, or new line.
                Use <code>@example.org</code> to allow a whole domain.
              </p>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
