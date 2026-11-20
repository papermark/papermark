import Link from "next/link";

import { Dispatch, SetStateAction, useMemo, useState } from "react";

import { PlanEnum } from "@/ee/stripe/constants";
import { Tag } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { mutate } from "swr";

import { usePlan } from "@/lib/swr/use-billing";
import { useTags } from "@/lib/swr/use-tags";
import { TagProps } from "@/lib/types";
import { cn } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select-v2";
import { ButtonTooltip } from "@/components/ui/tooltip";

import { DEFAULT_LINK_TYPE } from "..";

function getTagOption(tag: TagProps) {
  return {
    value: tag.id,
    label: tag.name,
    icon: (
      <Tag
        size={20}
        className={`rounded-sm border border-gray-200 bg-${tag.color}-100 p-1 dark:text-primary-foreground`}
      />
    ),
    meta: { color: tag.color, description: tag.description },
  };
}

/**
 * Compact tag control that lives inline on the link name row. Collapsed it
 * shows just a Tag icon; pressing it stretches a tag selector open to the left.
 */
export default function InlineTagSelector({
  data,
  setData,
  teamId,
}: {
  data: DEFAULT_LINK_TYPE;
  setData: Dispatch<SetStateAction<DEFAULT_LINK_TYPE>>;
  teamId: string;
}) {
  const [expanded, setExpanded] = useState((data.tags?.length ?? 0) > 0);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [selectedValues, setSelectedValues] = useState<string[]>(
    data.tags || [],
  );
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const { isFree } = usePlan();

  const {
    tagCount,
    tags: availableTags,
    loading: loadingTags,
  } = useTags({
    query: {
      sortBy: "createdAt",
      sortOrder: "desc",
    },
  });

  const options = useMemo(
    () => availableTags?.map((tag) => getTagOption(tag)),
    [availableTags],
  );

  const handleValueChange = (value: string[]) => {
    setSelectedValues(value);
    setData((prevData) => ({
      ...prevData,
      tags: value,
    }));
  };

  const createTag = async (tag: string) => {
    if (isFree && tagCount && tagCount >= 5) {
      setShowUpgradeModal(true);
      toast.error("You have reached the maximum number of tags.");
      return false;
    }

    const res = await fetch(`/api/teams/${teamId}/tags`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: tag }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      toast.error(error);
      return false;
    }

    const newTag = await res.json();
    await mutate(
      `/api/teams/${teamId}/tags?${new URLSearchParams({
        sortBy: "createdAt",
        sortOrder: "desc",
        includeLinksCount: false,
      } as Record<string, any>).toString()}`,
    );
    setSelectedValues([...selectedValues, newTag.id]);
    setData((prevData) => ({
      ...prevData,
      tags: [...prevData.tags, newTag.id],
    }));
    setIsPopoverOpen(false);
    toast.success(`Successfully created tag!`);
    return true;
  };

  const handleToggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      // Open the tag dropdown right away when stretching the field open.
      if (next) {
        setIsPopoverOpen(true);
      } else {
        setIsPopoverOpen(false);
      }
      return next;
    });
  };

  return (
    <div className="flex min-w-0 items-center justify-end gap-2">
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="inline-tags"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <MultiSelect
              loading={loadingTags}
              options={options ?? []}
              value={selectedValues}
              setIsPopoverOpen={setIsPopoverOpen}
              isPopoverOpen={isPopoverOpen}
              onValueChange={handleValueChange}
              placeholder="Select tags..."
              maxCount={2}
              searchPlaceholder="Search or add tags..."
              onCreate={(search) => createTag(search)}
              popoverClassName="w-[var(--radix-popover-trigger-width)] sm:w-[var(--radix-popover-trigger-width)] sm:max-w-none"
              footer={
                <Link
                  href="/settings/tags"
                  className="flex items-center rounded-sm px-2 py-1.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground hover:dark:bg-gray-700"
                >
                  Manage tags
                </Link>
              }
            />
          </motion.div>
        )}
      </AnimatePresence>

      <ButtonTooltip content={expanded ? "Hide tags" : "Add tags"}>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={handleToggle}
          aria-pressed={expanded}
          aria-label="Toggle tags"
          className={cn(
            "relative h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground sm:h-10 sm:w-10",
            (expanded || selectedValues.length > 0) && "text-foreground",
          )}
        >
          <Tag className="h-4 w-4" />
          {!expanded && selectedValues.length > 0 ? (
            <span className="absolute right-0 top-0 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {selectedValues.length}
            </span>
          ) : null}
        </Button>
      </ButtonTooltip>

      {showUpgradeModal && (
        <UpgradePlanModal
          clickedPlan={PlanEnum.Pro}
          trigger="create_tag"
          open={showUpgradeModal}
          setOpen={setShowUpgradeModal}
        />
      )}
    </div>
  );
}
