import { useEffect, useState } from "react";

import { motion } from "motion/react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { FADE_IN_ANIMATION_SETTINGS } from "@/lib/constants";

import { DEFAULT_LINK_TYPE } from ".";
import LinkItem from "./link-item";
import { LinkUpgradeOptions } from "./link-options";

export default function QuestionSection({
  data,
  setData,
  isAllowed,
  handleUpgradeStateChange,
}: {
  data: DEFAULT_LINK_TYPE;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_LINK_TYPE>>;
  isAllowed: boolean;
  handleUpgradeStateChange: ({
    state,
    trigger,
    plan,
  }: LinkUpgradeOptions) => void;
}) {
  const { enableQuestion, questionText, questionType } = data;
  const [enabled, setEnabled] = useState<boolean>(false);

  useEffect(() => {
    setEnabled(enableQuestion!);
  }, [enableQuestion]);

  const handleQuestion = async () => {
    const updatedQuestion = !enabled;

    setData({ ...data, enableQuestion: updatedQuestion });
    setEnabled(updatedQuestion);
  };

  return (
    <div className="pb-5">
      <LinkItem
        title="Feedback question"
        tooltipContent="Create a concise question for visitor feedback."
        enabled={enabled}
        action={handleQuestion}
        isAllowed={isAllowed}
        requiredPlan="business"
        upgradeAction={() =>
          handleUpgradeStateChange({
            state: true,
            trigger: "link_sheet_question_section",
            plan: "Business",
          })
        }
      />

      {enabled && (
        <motion.div
          className="relative mt-4 space-y-3"
          {...FADE_IN_ANIMATION_SETTINGS}
        >
          <div className="flex w-full flex-col items-start gap-6 overflow-x-visible pb-4 pt-0">
            <div className="w-full space-y-2">
              <Label>Question Type</Label>
              <Select defaultValue="yes-no">
                <SelectTrigger className="flex w-full rounded-md border border-input bg-white text-foreground placeholder-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-inset focus:ring-muted-foreground dark:border-gray-500 dark:bg-gray-800 focus:dark:bg-transparent sm:text-sm">
                  <SelectValue placeholder="Select a question type" />
                </SelectTrigger>
                <SelectContent className="z-50 flex w-full rounded-md border border-input bg-white text-foreground placeholder-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-inset focus:ring-muted-foreground dark:border-gray-500 dark:bg-gray-800 focus:dark:bg-gray-900 sm:text-sm">
                  <SelectItem value="yes-no">Yes / No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-full space-y-2">
              <Label htmlFor="question">Question</Label>
              <Input
                className="focus:ring-inset"
                id="question"
                type="text"
                name="question"
                required
                placeholder="Are you interested?"
                value={questionText || ""}
                onChange={(e) =>
                  setData({
                    ...data,
                    questionText: e.target.value,
                    questionType: "YES_NO",
                  })
                }
              />
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
