import { useEffect, useState } from "react";

import { PlanEnum } from "@/ee/stripe/constants";
import { differenceInDays, format, startOfDay, subDays } from "date-fns";
import { CalendarIcon, ChevronDown, CrownIcon } from "lucide-react";
import { DateRange } from "react-day-picker";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { cn } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";

const TIME_RANGES = [
  { value: "24h", label: "Last 24 hours", shortcut: "D" },
  { value: "7d", label: "Last 7 days", shortcut: "W" },
  { value: "30d", label: "Last 30 days", shortcut: "M" },
  { value: "custom", label: "Custom Date", shortcut: "C" },
] as const;

export type TimeRange = (typeof TIME_RANGES)[number]["value"];
interface CustomRange {
  start: Date;
  end: Date;
}
interface TimeRangeSelectProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
  customRange: CustomRange;
  setCustomRange: (range: CustomRange) => void;
  onCustomRangeComplete?: (range: CustomRange) => void;
  slug: React.MutableRefObject<boolean>;
  isPremium?: boolean;
}

export function TimeRangeSelect({
  value,
  onChange,
  customRange,
  setCustomRange,
  onCustomRangeComplete,
  slug,
  isPremium = false,
}: TimeRangeSelectProps) {
  const selectedRange = TIME_RANGES.find((range) => range.value === value);
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

  const handleSelectOption = (value: TimeRange) => {
    // Prevent selecting custom range for non-premium users
    if (value === "custom" && !isPremium) {
      toast.error("Upgrade to view data beyond 30 days");
      return;
    }

    onChange(value);

    // Update date range based on selected preset
    const now = new Date();
    const end = startOfDay(now);
    let start = startOfDay(now);

    switch (value) {
      case "24h":
        start = subDays(end, 1);
        break;
      case "7d":
        start = subDays(end, 7);
        break;
      case "30d":
        start = subDays(end, 30);
        break;
      case "custom":
        // Reset the date range when switching to custom
        setDate(undefined);
        return;
      default:
        return;
    }

    setCustomRange({ start, end });
    setDate({ from: start, to: end });
    slug.current = false;
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
      slug.current = false;
      setOpen(false);
      onCustomRangeComplete?.(newRange);
    } else if (range?.from) {
      setCustomRange({ start: range.from, end: range.from });
      onChange("custom");
      slug.current = false;
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
              {TIME_RANGES.map((range) => {
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
