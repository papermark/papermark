import {
  type Currency,
  CURRENCY_LABEL,
  CURRENCY_SYMBOL,
} from "@/ee/stripe/currency";

import { cn } from "@/lib/utils";

export type { Currency };

type Period = "monthly" | "yearly";

// Picks the display symbol/value for a plan price, falling back to the EUR
// amount when no USD price is configured. Shared so custom price layouts stay
// consistent with <PlanPrice>.
export function resolvePlanPrice({
  amount,
  amountUsd,
  currency,
}: {
  amount: number;
  amountUsd?: number;
  currency: Currency;
}): { symbol: string; value: number } {
  const useUsd = currency === "usd" && amountUsd != null;
  return {
    symbol: useUsd ? CURRENCY_SYMBOL.usd : CURRENCY_SYMBOL.eur,
    value: useUsd ? amountUsd : amount,
  };
}

// Renders a plan's monthly price in the selected currency. Falls back to the
// EUR amount when no USD price is configured for the plan.
export const PlanPrice = ({
  amount,
  amountUsd,
  period,
  currency,
}: {
  amount: number;
  amountUsd?: number;
  period: Period;
  currency: Currency;
}) => {
  const { symbol, value } = resolvePlanPrice({ amount, amountUsd, currency });

  return (
    <div className="mb-2 text-balance text-4xl font-medium tabular-nums text-gray-900 dark:text-white">
      {symbol}
      {value}
      <span className="text-base font-normal text-gray-500 dark:text-white/75">
        /month{period === "yearly" && ", billed annually"}
      </span>
    </div>
  );
};

type SegmentedOption<T extends string> = { value: T; label: string };

// Rounded-pill segmented switch shared by the currency and billing-period
// toggles so they stay visually consistent.
function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-full bg-gray-100 p-0.5 dark:bg-gray-800">
      {options.map((option) => {
        const isSelected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium transition-colors",
              isSelected
                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-100 dark:text-gray-900"
                : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const CURRENCY_OPTIONS: readonly SegmentedOption<Currency>[] = [
  { value: "usd", label: CURRENCY_LABEL.usd },
  { value: "eur", label: CURRENCY_LABEL.eur },
];

export const CurrencyToggle = ({
  value,
  onChange,
}: {
  value: Currency;
  onChange: (currency: Currency) => void;
}) => (
  <SegmentedToggle<Currency>
    options={CURRENCY_OPTIONS}
    value={value}
    onChange={onChange}
  />
);

const PERIOD_OPTIONS: readonly SegmentedOption<Period>[] = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Annually" },
];

export const PeriodToggle = ({
  value,
  onChange,
}: {
  value: Period;
  onChange: (period: Period) => void;
}) => (
  <SegmentedToggle<Period>
    options={PERIOD_OPTIONS}
    value={value}
    onChange={onChange}
  />
);
