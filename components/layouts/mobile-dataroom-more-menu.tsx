"use client";

import Link from "next/link";
import { useRouter } from "next/router";

import { useEffect, useState } from "react";

import { PlanEnum } from "@/ee/stripe/constants";
import {
  BarChart3Icon,
  BrushIcon,
  ChevronDownIcon,
  CogIcon,
  ContactIcon,
  HouseIcon,
  LinkIcon,
  LogsIcon,
  MessageSquareIcon,
  ServerIcon,
  ShieldCheckIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";

import { usePlan } from "@/lib/swr/use-billing";
import useLimits from "@/lib/swr/use-limits";
import { cn } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { DataroomLinkSheet } from "@/components/links/link-sheet/dataroom-link-sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface MobileDataroomMoreMenuProps {
  open: boolean;
  onClose: () => void;
  dataroomId: string;
}

function permissionsSectionActive(pathname: string) {
  return (
    (pathname.includes("permissions") && !pathname.includes("settings")) ||
    pathname.includes("/groups")
  );
}

function analyticsSubActive(pathname: string) {
  return pathname.includes("audit-log");
}

export function MobileDataroomMoreMenu({
  open,
  onClose,
  dataroomId,
}: MobileDataroomMoreMenuProps) {
  const router = useRouter();
  const { isTrial } = usePlan();
  const { limits } = useLimits();
  const [settingsExpanded, setSettingsExpanded] = useState(() =>
    router.pathname.includes("/settings"),
  );
  const [permissionsExpanded, setPermissionsExpanded] = useState(() =>
    permissionsSectionActive(router.pathname),
  );
  const [analyticsExpanded, setAnalyticsExpanded] = useState(() =>
    analyticsSubActive(router.pathname),
  );
  const [linkSheetOpen, setLinkSheetOpen] = useState(false);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      setPermissionsExpanded(permissionsSectionActive(router.pathname));
      setAnalyticsExpanded(analyticsSubActive(router.pathname));
      if (router.pathname.includes("/settings")) {
        setSettingsExpanded(true);
      }
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, router.pathname]);

  const rowClass = (active: boolean) =>
    cn(
      "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors",
      active
        ? "bg-muted text-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  const subLinkClass = (href: string) =>
    cn(
      "block rounded-md px-3 py-2 text-sm transition-colors",
      router.asPath.split("?")[0] === href ||
        router.asPath.split("?")[0].startsWith(`${href}/`)
        ? "font-medium text-foreground"
        : "text-muted-foreground hover:text-foreground",
    );

  const base = `/datarooms/${dataroomId}`;

  const settingsSubItems = [
    { label: "General", href: `${base}/settings` },
    { label: "Introduction", href: `${base}/settings/introduction` },
    { label: "Notifications", href: `${base}/settings/notifications` },
    { label: "Downloads", href: `${base}/settings/downloads` },
    { label: "File Permissions", href: `${base}/settings/file-permissions` },
  ];

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] [-webkit-tap-highlight-color:transparent] touch-manipulation md:hidden">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <span className="text-lg font-semibold">More</span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-4">
            <div className="space-y-1">
              <Button
                type="button"
                variant="secondary"
                className="mb-3 w-full"
                onClick={() => {
                  onClose();
                  setLinkSheetOpen(true);
                }}
              >
                Share dataroom
              </Button>

              <Link
                href="/dashboard"
                onClick={onClose}
                className={rowClass(false)}
              >
                <HouseIcon className="h-5 w-5" />
                Dashboard
              </Link>

              <Link
                href="/datarooms"
                onClick={onClose}
                className={rowClass(false)}
              >
                <ServerIcon className="h-5 w-5" />
                All datarooms
              </Link>

              <Separator className="my-3" />

              <div>
                <button
                  type="button"
                  onClick={() => setPermissionsExpanded((v) => !v)}
                  className={rowClass(
                    permissionsSectionActive(router.pathname),
                  )}
                >
                  <ShieldCheckIcon className="h-5 w-5" />
                  Permissions
                  <ChevronDownIcon
                    className={cn(
                      "ml-auto h-4 w-4 transition-transform",
                      permissionsExpanded && "rotate-180",
                    )}
                  />
                </button>
                {permissionsExpanded && (
                  <div className="ml-8 mt-1 space-y-0.5 border-l border-border pl-3">
                    <Link
                      href={`${base}/permissions`}
                      onClick={onClose}
                      className={subLinkClass(`${base}/permissions`)}
                    >
                      <span className="flex items-center gap-2">
                        <LinkIcon className="h-4 w-4 shrink-0" />
                        Links
                      </span>
                    </Link>
                    <Link
                      href={`${base}/groups`}
                      onClick={onClose}
                      className={subLinkClass(`${base}/groups`)}
                    >
                      <span className="flex items-center gap-2">
                        <UsersIcon className="h-4 w-4 shrink-0" />
                        Groups
                      </span>
                    </Link>
                  </div>
                )}
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setAnalyticsExpanded((v) => !v)}
                  className={rowClass(analyticsSubActive(router.pathname))}
                >
                  <BarChart3Icon className="h-5 w-5" />
                  Analytics
                  <ChevronDownIcon
                    className={cn(
                      "ml-auto h-4 w-4 transition-transform",
                      analyticsExpanded && "rotate-180",
                    )}
                  />
                </button>
                {analyticsExpanded && (
                  <div className="ml-8 mt-1 space-y-0.5 border-l border-border pl-3">
                    <Link
                      href={`${base}/analytics`}
                      onClick={onClose}
                      className={subLinkClass(`${base}/analytics`)}
                    >
                      <span className="flex items-center gap-2">
                        <BarChart3Icon className="h-4 w-4 shrink-0" />
                        Overview
                      </span>
                    </Link>
                    <Link
                      href={`${base}/analytics/audit-log`}
                      onClick={onClose}
                      className={subLinkClass(`${base}/analytics/audit-log`)}
                    >
                      <span className="flex items-center gap-2">
                        <LogsIcon className="h-4 w-4 shrink-0" />
                        Audit log
                      </span>
                    </Link>
                  </div>
                )}
              </div>

              <Separator className="my-3" />

              {!limits?.conversationsInDataroom ? (
                <UpgradePlanModal
                  clickedPlan={PlanEnum.DataRoomsPlus}
                  trigger="mobile_dataroom_more_qa"
                  highlightItem={["qa"]}
                >
                  <button type="button" className={rowClass(false)}>
                    <MessageSquareIcon className="h-5 w-5" />
                    Q&A
                  </button>
                </UpgradePlanModal>
              ) : (
                <Link
                  href={`${base}/conversations`}
                  onClick={onClose}
                  className={rowClass(
                    router.pathname.includes("conversations"),
                  )}
                >
                  <MessageSquareIcon className="h-5 w-5" />
                  Q&A
                </Link>
              )}

              <Link
                href={`${base}/users`}
                onClick={onClose}
                className={rowClass(router.pathname.includes("/users"))}
              >
                <ContactIcon className="h-5 w-5" />
                Visitors
              </Link>

              <Link
                href={`${base}/branding`}
                onClick={onClose}
                className={rowClass(router.pathname.includes("branding"))}
              >
                <BrushIcon className="h-5 w-5" />
                Branding
              </Link>

              <div>
                <button
                  type="button"
                  onClick={() => setSettingsExpanded((v) => !v)}
                  className={rowClass(router.pathname.includes("/settings"))}
                >
                  <CogIcon className="h-5 w-5" />
                  Settings
                  <ChevronDownIcon
                    className={cn(
                      "ml-auto h-4 w-4 transition-transform",
                      settingsExpanded && "rotate-180",
                    )}
                  />
                </button>
                {settingsExpanded && (
                  <div className="ml-8 mt-1 space-y-0.5 border-l border-border pl-3">
                    {settingsSubItems.map((sub) => (
                      <Link
                        key={sub.href}
                        href={sub.href}
                        onClick={onClose}
                        className={subLinkClass(sub.href)}
                      >
                        {sub.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {isTrial && (
                <div className="mt-4">
                  <Link
                    href="/settings/upgrade?view=datarooms"
                    onClick={onClose}
                    className="flex w-full items-center justify-center rounded-lg bg-foreground px-4 py-3 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
                  >
                    Upgrade Plan
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <DataroomLinkSheet
        isOpen={linkSheetOpen}
        setIsOpen={setLinkSheetOpen}
        linkType="DATAROOM_LINK"
        linkTargetId={dataroomId}
      />
    </>
  );
}
