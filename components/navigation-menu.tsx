"use client";

import Link from "next/link";
import { useRouter } from "next/router";

import * as React from "react";

import { PlanEnum } from "@/ee/stripe/constants";
import { CrownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { Separator } from "@/components/ui/separator";

import { UpgradePlanModal } from "./billing/upgrade-plan-modal";

type Props = {
  navigation: {
    label: string;
    href: string;
    segment: string | null;
    tag?: string;
    count?: number;
    disabled?: boolean;
    limited?: boolean;
  }[];
  className?: string;
};

export const NavMenu: React.FC<React.PropsWithChildren<Props>> = ({
  navigation,
  className,
}) => {
  return (
    <nav
      className={cn("sticky top-0 bg-background dark:bg-gray-900", className)}
    >
      <div className="flex w-full items-center overflow-x-auto px-4 pl-1">
        <ul className="flex flex-row gap-4">
          {navigation.map(
            ({ label, href, segment, tag, count, disabled, limited }) => (
              <NavItem
                key={label}
                label={label}
                href={href}
                segment={segment}
                tag={tag}
                count={count}
                disabled={disabled}
                limited={limited}
              />
            ),
          )}
        </ul>
      </div>
      <Separator />
    </nav>
  );
};

const NavItem: React.FC<Props["navigation"][0]> = ({
  label,
  href,
  segment,
  tag,
  count,
  disabled,
  limited,
}) => {
  const router = useRouter();
  // active is true if the segment included in the pathname, but not if it's the root pathname. unless the segment is the root pathname.
  let active =
    router.pathname.includes(segment as string) &&
    segment !== "/datarooms/[id]";

  if (segment === "/datarooms/[id]") {
    active = router.pathname === "/datarooms/[id]";
  }

  // Special case for permissions - also active when pathname includes "groups"
  // but NOT when it's within settings (like settings/file-permissions)
  if (segment === "permissions") {
    active =
      (router.pathname.includes("permissions") &&
        !router.pathname.includes("settings")) ||
      router.pathname.includes("groups");
  }

  if (segment === "analytics" && router.pathname.includes("groups")) {
    active = false;
  }

  return (
    <li
      key={label}
      className={cn(
        "flex shrink-0 list-none border-b-2 border-transparent p-2",
        {
          "border-primary": active,
          hidden: disabled,
        },
      )}
    >
      {limited ? (
        <UpgradePlanModal
          key={label}
          clickedPlan={PlanEnum.DataRoomsPlus}
          trigger={label}
          highlightItem={["qa"]}
        >
          <div className="text-content-subtle hover:bg-background-subtle -mx-3 flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted hover:text-primary">
            {label}
            <CrownIcon className="h-4 w-4 text-muted-foreground" />
          </div>
        </UpgradePlanModal>
      ) : (
        <Link
          href={href}
          className={cn(
            "text-content-subtle hover:bg-background-subtle -mx-3 flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted hover:text-primary",
            {
              "text-primary": active,
            },
          )}
        >
          {label}
          {count !== undefined && count > 0 ? (
            <div className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
              {count > 99 ? "99+" : count}
            </div>
          ) : tag ? (
            <div className="text-content-subtle rounded border bg-background px-1 py-0.5 font-mono text-xs">
              {tag}
            </div>
          ) : null}
        </Link>
      )}
    </li>
  );
};
