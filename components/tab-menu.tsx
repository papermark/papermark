import Link from "next/link";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { cn } from "@/lib/utils";

type Props = {
  navigation: {
    label: string;
    href: string;
    value: string;
    currentValue: string;
    count?: number;
    tag?: string;
    disabled?: boolean;
  }[];
  className?: string;
};

export const TabMenu: React.FC<React.PropsWithChildren<Props>> = ({
  navigation,
  className,
}) => {
  return (
    <nav
      className={cn("sticky top-0 bg-background dark:bg-gray-950", className)}
    >
      <div className="flex w-full items-center overflow-x-auto px-4">
        <ul className="flex flex-row gap-4">
          {navigation.map(
            ({ label, href, value, currentValue, count, tag, disabled }) => (
              <TabItem
                key={label}
                label={label}
                href={href}
                value={value}
                currentValue={currentValue}
                count={count}
                tag={tag}
                disabled={disabled}
              />
            ),
          )}
        </ul>
      </div>
      <Separator />
    </nav>
  );
};

const TabItem: React.FC<Props["navigation"][0]> = ({
  label,
  href,
  value,
  currentValue,
  count,
  tag,
  disabled,
}) => {
  const active = value === currentValue;

  return (
    <li
      className={cn(
        "flex shrink-0 list-none border-b-2 border-transparent p-2",
        {
          "border-primary": active,
          hidden: disabled,
        },
      )}
    >
      <Link
        href={href}
        className={cn(
          "-mx-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted hover:text-primary",
          {
            "font-medium": active,
          },
        )}
      >
        {label}
        {count !== undefined && (
          <Badge
            variant="secondary"
            className={cn("ml-auto", {
              "bg-primary/10 hover:bg-primary/20": active,
            })}
          >
            {count}
          </Badge>
        )}
        {tag ? (
          <div className="rounded border bg-background px-1 py-0.5 font-mono text-xs">
            {tag}
          </div>
        ) : null}
      </Link>
    </li>
  );
};
