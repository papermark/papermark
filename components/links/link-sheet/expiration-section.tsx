import { useCallback, useEffect, useState } from "react";

import { LinkPreset } from "@prisma/client";
import { motion } from "motion/react";

import { FADE_IN_ANIMATION_SETTINGS } from "@/lib/constants";
import { formatExpirationTime } from "@/lib/utils";

import { SmartDateTimePicker } from "@/components/ui/smart-date-time-picker";

import { DEFAULT_LINK_TYPE } from ".";
import LinkItem from "./link-item";

export default function ExpirationSection({
  data,
  setData,
  presets,
}: {
  data: DEFAULT_LINK_TYPE;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_LINK_TYPE>>;
  presets: LinkPreset | null;
}) {
  const { expiresAt } = data;
  const [enabled, setEnabled] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [customDate, setCustomDate] = useState<Date | null>(null);

  useEffect(() => {
    setEnabled(!!expiresAt);
    setCustomDate(expiresAt);
  }, [expiresAt]);

  useEffect(() => {
    if (presets?.expiresIn) {
      setEnabled(true);
      handlePresetChange(presets.expiresIn);
    }
  }, [presets]);

  const handleEnableExpiration = () => {
    if (enabled) {
      // if expiration is currently set and we're toggling it off
      setData({ ...data, expiresAt: null });
    }
    setEnabled(!enabled);
  };

  const handlePresetChange = (value: number) => {
    setError(null);

    const seconds = value;
    if (!isNaN(seconds)) {
      const newExpiresAt = new Date();
      newExpiresAt.setSeconds(newExpiresAt.getSeconds() + seconds);
      setData({ ...data, expiresAt: newExpiresAt });
      setCustomDate(newExpiresAt);
    }
  };

  const handleCustomDateChange = (date: Date | null) => {
    if (!date) {
      setError("Please select a valid date");
      return;
    }

    const now = new Date();
    if (date <= now) {
      console.log("date <= now", now, date);

      // Always add 1 day (86400000 milliseconds) to current time
      const newDate = new Date(now.getTime() + 86400 * 1000);

      setData({ ...data, expiresAt: newDate });
      setCustomDate(newDate);
      setError("Expiration time must be in the future. Set to tomorrow.");
      return;
    }

    setData({ ...data, expiresAt: date });
    setCustomDate(date);
    setError(null);
  };

  const expirationTime = useCallback((date: Date | string) => {
    const now = new Date();
    const dateObj = typeof date === "string" ? new Date(date) : date;
    const diffInSeconds = Math.floor(
      (dateObj.getTime() - now.getTime()) / 1000,
    );
    return formatExpirationTime(diffInSeconds);
  }, []);

  const formatNaturalExpiration = useCallback((date: Date | string) => {
    const now = new Date();
    const dateObj = typeof date === "string" ? new Date(date) : date;

    const formattedDate = dateObj.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    const formattedTime = dateObj.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    if (dateObj.toDateString() === now.toDateString()) {
      return `today at ${formattedTime}`;
    }

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (dateObj.toDateString() === tomorrow.toDateString()) {
      return `tomorrow at ${formattedTime}`;
    }

    return `on ${formattedDate} at ${formattedTime}`;
  }, []);

  return (
    <div className="pb-5">
      <LinkItem
        title="Expiration date"
        enabled={enabled}
        link="https://www.papermark.com/help/article/expiration-date"
        action={handleEnableExpiration}
        tooltipContent="Set a date after which the link will no longer be accessible."
      />

      {enabled && (
        <motion.div className="mt-3 space-y-3" {...FADE_IN_ANIMATION_SETTINGS}>
          <div className="flex flex-col space-y-2">
            <SmartDateTimePicker
              value={customDate}
              onChange={handleCustomDateChange}
              placeholder='e.g. "in 2 days", "next Friday at 3pm"'
            />

            {expiresAt && (
              <div className="text-xs text-muted-foreground">
                <div>
                  Link will expire {formatNaturalExpiration(expiresAt)} (in{" "}
                  {expirationTime(expiresAt)})
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
