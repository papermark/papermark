import { cn } from "@/lib/utils";

interface Stat {
  name: string;
  /** Shown below `sm` when set; avoids long labels in narrow 3-up layout */
  shortName?: string;
  value: string;
  unit?: string;
  active: boolean;
}
interface StatsElementProps {
  stat: Stat;
  statIdx: number;
}

export default function StatsElement({ stat, statIdx }: StatsElementProps) {
  const label = (
    <>
      <span className="sm:hidden">{stat.shortName ?? stat.name}</span>
      <span className="hidden sm:inline">{stat.name}</span>
    </>
  );

  return (
    <div
      key={statIdx}
      className="min-w-0 overflow-hidden rounded-lg border border-foreground/5 px-2 py-2 sm:px-6 sm:py-6 xl:px-8"
    >
      <div
        className={cn(
          "flex flex-col gap-0.5 sm:flex-col sm:items-start sm:gap-2 lg:flex-row lg:items-center lg:gap-2",
          !stat.active
            ? "text-gray-300 dark:text-gray-700"
            : "text-muted-foreground",
        )}
      >
        <p className="text-[10px] font-medium capitalize leading-tight sm:whitespace-nowrap sm:text-sm sm:leading-6">
          {label}
        </p>
      </div>

      <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-0.5 sm:mt-3 sm:gap-x-2">
        <span
          className={cn(
            !stat.active
              ? "text-gray-300 dark:text-gray-700"
              : "text-foreground",
            "truncate text-lg font-semibold tabular-nums tracking-tight sm:text-4xl",
          )}
        >
          {stat.value}
        </span>
        {stat.unit ? (
          <span
            className={cn(
              !stat.active
                ? "text-gray-300 dark:text-gray-700"
                : "text-muted-foreground",
              "text-[10px] leading-none sm:text-sm",
            )}
          >
            {stat.unit}
          </span>
        ) : null}
      </p>
    </div>
  );
}
