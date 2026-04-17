import Link from "next/link";
import { useRouter } from "next/router";

import { useEffect, useState } from "react";

import { useTeam } from "@/context/team-context";
import {
  BrushIcon,
  ChevronDownIcon,
  CogIcon,
  ContactIcon,
  XIcon,
} from "lucide-react";

import { useIsAdmin } from "@/lib/hooks/use-is-admin";
import { usePlan } from "@/lib/swr/use-billing";
import useLimits from "@/lib/swr/use-limits";
import { useSlackIntegration } from "@/lib/swr/use-slack-integration";
import { PlanEnum } from "@/ee/stripe/constants";
import { cn, nFormatter } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { Progress } from "@/components/ui/progress";

import { SlackIcon } from "../shared/icons/slack-icon";

interface MobileMoreMenuProps {
  open: boolean;
  onClose: () => void;
}

export function MobileMoreMenu({ open, onClose }: MobileMoreMenuProps) {
  const router = useRouter();
  const { currentTeam } = useTeam() || {};
  const { isFree, isTrial } = usePlan();
  const { limits } = useLimits();
  const { isAdmin } = useIsAdmin();
  const { integration: slackIntegration } = useSlackIntegration({
    enabled: !!currentTeam?.id,
  });
  const [settingsExpanded, setSettingsExpanded] = useState(
    () => router.pathname.includes("settings"),
  );

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  const linksLimit = limits?.links;
  const documentsLimit = limits?.documents;

  const settingsSubItems = [
    { label: "General", href: "/settings/general" },
    { label: "Team", href: "/settings/people" },
    { label: "Domains", href: "/settings/domains" },
    { label: "Notifications", href: "/settings/notifications" },
    { label: "Webhooks", href: "/settings/webhooks" },
    { label: "Slack", href: "/settings/slack" },
    ...(isAdmin
      ? [
          { label: "Security", href: "/settings/security" },
          { label: "Billing", href: "/settings/billing" },
        ]
      : []),
  ];

  return (
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
          {isFree && !isTrial ? (
            <UpgradePlanModal
              clickedPlan={PlanEnum.Pro}
              trigger="mobile_more_visitors"
              highlightItem={["visitors"]}
            >
              <button
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ContactIcon className="h-5 w-5" />
                Visitors
              </button>
            </UpgradePlanModal>
          ) : (
            <Link
              href="/visitors"
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors",
                router.pathname.includes("visitors")
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <ContactIcon className="h-5 w-5" />
              Visitors
            </Link>
          )}

          <Link
            href="/branding"
            onClick={onClose}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors",
              router.pathname.includes("branding")
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <BrushIcon className="h-5 w-5" />
            Branding
          </Link>

          {/* Settings with expandable sub-items */}
          <div>
            <button
              onClick={() => setSettingsExpanded((v) => !v)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors",
                router.pathname.includes("settings")
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
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
                    className={cn(
                      "block rounded-md px-3 py-2 text-sm transition-colors",
                      router.pathname.includes(
                        sub.href.replace("/settings/", "settings/"),
                      )
                        ? "font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {sub.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {!slackIntegration && (
            <Link
              href="/settings/slack"
              onClick={onClose}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <SlackIcon className="h-5 w-5" />
              Connect Slack
            </Link>
          )}
        </div>

        {(linksLimit || documentsLimit) && (
          <div className="mt-6 space-y-3 rounded-lg border border-border p-4">
            <p className="text-xs font-medium text-muted-foreground">Usage</p>
            {linksLimit ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground">Links</span>
                  <span className="text-muted-foreground">
                    {nFormatter(limits?.usage?.links ?? 0)} /{" "}
                    {nFormatter(linksLimit)}
                  </span>
                </div>
                <Progress
                  value={
                    limits?.usage?.links
                      ? (limits.usage.links / linksLimit) * 100
                      : 0
                  }
                  className="h-1 bg-muted"
                  max={100}
                />
              </div>
            ) : null}
            {documentsLimit ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground">Documents</span>
                  <span className="text-muted-foreground">
                    {nFormatter(limits?.usage?.documents ?? 0)} /{" "}
                    {nFormatter(documentsLimit)}
                  </span>
                </div>
                <Progress
                  value={
                    limits?.usage?.documents
                      ? (limits.usage.documents / documentsLimit) * 100
                      : 0
                  }
                  className="h-1 bg-muted"
                  max={100}
                />
              </div>
            ) : null}
          </div>
        )}

        {isTrial && (
          <div className="mt-4">
            <Link
              href="/settings/upgrade?view=business-datarooms"
              onClick={onClose}
              className="flex w-full items-center justify-center rounded-lg bg-foreground px-4 py-3 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
            >
              Upgrade Plan
            </Link>
          </div>
        )}
        {isFree && !isTrial && (
          <div className="mt-4">
            <Link
              href="/settings/billing"
              onClick={onClose}
              className="flex w-full items-center justify-center rounded-lg bg-foreground px-4 py-3 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
            >
              Upgrade Papermark
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
