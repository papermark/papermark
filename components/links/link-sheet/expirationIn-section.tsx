import { useCallback, useEffect, useState } from "react";

import { motion } from "motion/react";

import { FADE_IN_ANIMATION_SETTINGS } from "@/lib/constants";
import { formatExpirationTime } from "@/lib/utils";

import { SmartDateTimePicker } from "@/components/ui/smart-date-time-picker";

import { DEFAULT_LINK_TYPE } from ".";
import LinkItem from "./link-item";

export default function ExpirationInSection({
  data,
  setData,
}: {
  data: DEFAULT_LINK_TYPE & {
    expiresIn?: number | null;
  };
  setData: React.Dispatch<
    React.SetStateAction<
      DEFAULT_LINK_TYPE & {
        expiresIn?: number | null;
      }
    >
  >;
}) {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [customDate, setCustomDate] = useState<Date | null>(null);

  const resetStates = useCallback(() => {
    setError(null);
    setCustomDate(null);
  }, []);

  // Initialize state based on existing expiresIn data
  useEffect(() => {
    if (!data.expiresIn) {
      setEnabled(false);
      resetStates();
      return;
    }

    setEnabled(true);

    if (data.expiresIn) {
      const futureDate = new Date();
      futureDate.setSeconds(futureDate.getSeconds() + data.expiresIn);
      setCustomDate(futureDate);
    }
  }, [data.expiresIn]);

  const handleEnableExpiration = useCallback(() => {
    if (enabled) {
      setData({
        ...data,
        expiresIn: null,
      });
      resetStates();
    } else {
      // Enable with default 7 days expiration
      setData({
        ...data,
        expiresIn: 604800,
      });
      setError(null);
      setCustomDate(null);
    }
    setEnabled(!enabled);
  }, [enabled, data, resetStates]);

  resetStates;

  const handleCustomDateChange = useCallback(
    (date: Date | null) => {
      if (!date) {
        return;
      }

      const now = new Date();
      const diffMs = date.getTime() - now.getTime();
      const diffSeconds = Math.ceil(diffMs / 1000);

      if (diffSeconds <= 0) {
        setError("Please enter a future duration");
        return;
      }

      setData({
        ...data,
        expiresIn: diffSeconds,
      });
      setCustomDate(date);
      setError(null);
    },
    [data, setData],
  );

  // Custom formatter to show only the duration
  const formatValue = useCallback((date: Date | null) => {
    if (!date) return "";
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffSeconds = Math.ceil(diffMs / 1000);
    return "in " + formatExpirationTime(diffSeconds);
  }, []);

  return (
    <div className="pb-5">
      <LinkItem
        title="Link expires after"
        enabled={enabled}
        link="https://www.papermark.com/help/article/expiration-date"
        action={handleEnableExpiration}
        tooltipContent="Set how long the link will remain active after creation."
      />

      {enabled && (
        <motion.div className="mt-3 space-y-3" {...FADE_IN_ANIMATION_SETTINGS}>
          <div className="flex flex-col space-y-2">
            <SmartDateTimePicker
              value={customDate}
              onChange={handleCustomDateChange}
              placeholder='E.g. "in 2 hours" or "in 2 days"'
              formatValue={formatValue}
              showCalendarIcon={false}
            />

            {data.expiresIn && (
              <div className="text-xs text-muted-foreground">
                <div>
                  Links will expire in {formatExpirationTime(data.expiresIn)}{" "}
                  after creation
                </div>
              </div>
            )}

            {error && <div className="text-xs text-red-500">{error}</div>}
          </div>
        </motion.div>
      )}
    </div>
  );
}
