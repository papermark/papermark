import { useEffect, useState } from "react";

import { PlanEnum } from "@/ee/stripe/constants";
import { differenceInDays, format, startOfDay, subDays } from "date-fns";
import { CalendarIcon, ChevronDown, CrownIcon } from "lucide-react";
import { DateRange } from "react-day-picker";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export const TIME_RANGES = [
  { value: "24h", label: "Last 24 hours", shortcut: "D" },
  { value: "7d", label: "Last 7 days", shortcut: "W" },
  { value: "30d", label: "Last 30 days", shortcut: "M" },
  { value: "all", label: "All time", shortcut: "A" },
  { value: "custom", label: "Custom Date", shortcut: "C" },
] as const;

export type TimeRange = (typeof TIME_RANGES)[number]["value"];

/** The dashboard's API only understands these; data rooms additionally offer "all". */
export type DashboardTimeRange = Exclude<TimeRange, "all">;

export const DASHBOARD_TIME_RANGES = TIME_RANGES.filter(
  (
    range,
  ): range is Extract<
    (typeof TIME_RANGES)[number],
    { value: DashboardTimeRange }
  > => range.value !== "all",
);

export function isDashboardTimeRange(
  value: unknown,
): value is DashboardTimeRange {
  return DASHBOARD_TIME_RANGES.some((range) => range.value === value);
}

interface CustomRange {
  start: Date;
  end: Date;
}
interface TimeRangeSelectProps<T extends TimeRange> {
  value: T;
  /** The calendar commits a custom range regardless of which presets are offered. */
  onChange: (value: NoInfer<T> | "custom") => void;
  /** Pass the dashboard set to keep "All time" out of both the UI and the callback. */
  ranges: readonly { value: T; label: string }[];
  customRange: CustomRange;
  setCustomRange: (range: CustomRange) => void;
  onCustomRangeComplete?: (range: CustomRange) => void;
  /** Dashboard-only latch recording that the user has picked a range. */
  slug?: React.MutableRefObject<boolean>;
  isPremium?: boolean;
}

export function TimeRangeSelect<T extends TimeRange>({
  value,
  onChange,
  ranges,
  customRange,
  setCustomRange,
  onCustomRangeComplete,
  slug,
  isPremium = false,
}: TimeRangeSelectProps<T>) {
  const selectedRange = ranges.find((range) => range.value === value);
  const [date, setDate] = useState<DateRange | undefined>({
    from: customRange.start,
    to: customRange.end,
  });
  const [open, setOpen] = useState(false);

  // Calculate the minimum allowed date (30 days ago for non-premium)
  const minDate = isPremium ? undefined : subDays(new Date(), 30);

  useEffect(() => {
    setDate({ from: customRange.start, to: customRange.end });
  }, [customRange]);

  const handleSelectOption = (selected: T) => {
    // Prevent selecting custom range for non-premium users
    if (selected === "custom" && !isPremium) {
      toast.error("Upgrade to view data beyond 30 days");
      return;
    }

    onChange(selected);

    // Update date range based on selected preset
    const now = new Date();
    const end = startOfDay(now);
    let start = startOfDay(now);

    const preset: TimeRange = selected;
    switch (preset) {
      case "24h":
        start = subDays(end, 1);
        break;
      case "7d":
        start = subDays(end, 7);
        break;
      case "30d":
        start = subDays(end, 30);
        break;
      case "all":
        setDate(undefined);
        if (slug) slug.current = false;
        setOpen(false);
        return;
      case "custom":
        // Reset the date range when switching to custom
        setDate(undefined);
        return;
      default: {
        const exhaustive: never = preset;
        return exhaustive;
      }
    }

    setCustomRange({ start, end });
    setDate({ from: start, to: end });
    if (slug) slug.current = false;
    setOpen(false);
  };

  const handleRangeChange = (range: DateRange | undefined) => {
    setDate(range);
    if (range?.from && range?.to) {
      // Check if the selected range is within limits for non-premium users
      if (
        !isPremium &&
        (differenceInDays(new Date(), range.from) > 30 ||
          differenceInDays(new Date(), range.to) > 30)
      ) {
        toast.error("Upgrade to view data beyond 30 days");
        return;
      }

      const newRange = { start: range.from, end: range.to };
      setCustomRange(newRange);
      onChange("custom");
      if (slug) slug.current = false;
      setOpen(false);
      onCustomRangeComplete?.(newRange);
    } else if (range?.from) {
      setCustomRange({ start: range.from, end: range.from });
      onChange("custom");
      if (slug) slug.current = false;
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-auto justify-between text-left font-normal sm:w-[300px]",
            !date && "text-muted-foreground",
          )}
        >
          <div className="flex items-center gap-1.5 sm:gap-2">
            <CalendarIcon className="h-4 w-4 shrink-0" />
            <span className="text-xs sm:text-sm">
              {value === "custom" && date?.from ? (
                <>
                  {format(date.from, "MMM d")} -{" "}
                  {format(date.to || date.from, "MMM d, yyyy")}
                </>
              ) : (
                selectedRange?.label
              )}
            </span>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="end">
        <div className="flex gap-2">
          <div className="rounded-md border">
            <Calendar
              mode="range"
              defaultMonth={date?.from}
              selected={date}
              onSelect={handleRangeChange}
              numberOfMonths={2}
              disabled={
                !isPremium
                  ? (date) => {
                      if (!date) return false;
                      return differenceInDays(new Date(), date) > 30;
                    }
                  : undefined
              }
              fromDate={minDate}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="grid gap-1">
              {ranges.map((range) => {
                if (isPremium || range.value !== "custom") {
                  return (
                    <Button
                      key={range.value}
                      variant={range.value === value ? "secondary" : "ghost"}
                      className="justify-between"
                      onClick={() => handleSelectOption(range.value)}
                    >
                      <span>{range.label}</span>
                      {/* <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                        {range.shortcut}
                      </kbd> */}
                    </Button>
                  );
                } else {
                  return <UpgradeButton key={range.value} />;
                }
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const UpgradeButton = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        className="justify-between text-muted-foreground"
        onClick={() => setOpen(true)}
        title="Upgrade to view data beyond 30 days"
      >
        Custom Date <CrownIcon className="!size-4" />
      </Button>
      <UpgradePlanModal
        clickedPlan={PlanEnum.Pro}
        trigger="dashboard_time_range_custom_select"
        open={open}
        setOpen={setOpen}
      />
    </>
  );
};
