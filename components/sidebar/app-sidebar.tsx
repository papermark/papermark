"use client";

import { useRouter } from "next/router";

import * as React from "react";
import { useEffect, useState } from "react";

import { TeamContextType, initialState, useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import Cookies from "js-cookie";
import {
  BrushIcon,
  CogIcon,
  ContactIcon,
  FolderIcon,
  HouseIcon,
  Loader,
  ServerIcon,
  WorkflowIcon,
} from "lucide-react";

import { useFeatureFlags } from "@/lib/hooks/use-feature-flags";
import { useIsAdmin } from "@/lib/hooks/use-is-admin";
import { usePlan } from "@/lib/swr/use-billing";
import useDataroomsSimple from "@/lib/swr/use-datarooms-simple";
import useLimits from "@/lib/swr/use-limits";
import { useSlackIntegration } from "@/lib/swr/use-slack-integration";
import { nFormatter } from "@/lib/utils";

import { NavMain } from "@/components/sidebar/nav-main";
import { TeamSwitcher } from "@/components/sidebar/team-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import ProBanner from "../billing/pro-banner";
import { Progress } from "../ui/progress";
import SlackBanner from "./banners/slack-banner";

export function AppSidebarContent() {
  const router = useRouter();
  const [showProBanner, setShowProBanner] = useState<boolean | null>(null);
  const [showSlackBanner, setShowSlackBanner] = useState<boolean | null>(null);
  const { currentTeam, teams, setCurrentTeam, isLoading }: TeamContextType =
    useTeam() || initialState;
  const {
    isBusiness,
    isDatarooms,
    isDataroomsPlus,
    isFree,
    isTrial,
  } = usePlan();

  const { limits } = useLimits();
  const linksLimit = limits?.links;
  const documentsLimit = limits?.documents;

  // Check Slack integration status
  const { integration: slackIntegration } = useSlackIntegration({
    enabled: !!currentTeam?.id,
  });

  // Check feature flags
  const { features } = useFeatureFlags();

  // Check if current user is admin (for gating Security & Billing)
  const { isAdmin } = useIsAdmin();

  // Fetch datarooms for the current team (simple mode - no filters or extra data)
  const { datarooms } = useDataroomsSimple();

  useEffect(() => {
    if (Cookies.get("hideProBanner") !== "pro-banner") {
      setShowProBanner(true);
    } else {
      setShowProBanner(false);
    }
    if (Cookies.get("hideSlackBanner") !== "slack-banner") {
      setShowSlackBanner(true);
    } else {
      setShowSlackBanner(false);
    }
  }, []);

  // Prepare datarooms items for sidebar (limit to first 5, sorted by most recent)
  const dataroomItems =
    datarooms && datarooms.length > 0
      ? datarooms.slice(0, 5).map((dataroom) => ({
          title: dataroom.internalName || dataroom.name,
          url: `/datarooms/${dataroom.id}/documents`,
          current:
            router.pathname.includes("/datarooms/[id]") &&
            String(router.query.id) === String(dataroom.id),
        }))
      : undefined;

  const data = {
    navMain: [
      {
        title: "Dashboard",
        url: "/dashboard",
        icon: HouseIcon,
        current: router.pathname.includes("dashboard"),
      },
      {
        title: "All Documents",
        url: "/documents",
        icon: FolderIcon,
        current:
          router.pathname.includes("documents") &&
          !router.pathname.includes("datarooms"),
      },
      {
        title: "All Datarooms",
        url: "/datarooms",
        icon: ServerIcon,
        current: router.pathname === "/datarooms",
        disabled: !isBusiness && !isDatarooms && !isDataroomsPlus && !isTrial,
        trigger: "sidebar_datarooms",
        plan: PlanEnum.Business,
        highlightItem: ["datarooms"],
        isActive:
          router.pathname.includes("datarooms") &&
          (isBusiness || isDatarooms || isDataroomsPlus || isTrial),
        items:
          isBusiness || isDatarooms || isDataroomsPlus || isTrial
            ? dataroomItems
            : undefined,
      },
      {
        title: "Visitors",
        url: "/visitors",
        icon: ContactIcon,
        current: router.pathname.includes("visitors"),
        disabled: isFree && !isTrial,
        trigger: "sidebar_visitors",
        plan: PlanEnum.Pro,
        highlightItem: ["visitors"],
      },
      {
        title: "Workflows",
        url: "/workflows",
        icon: WorkflowIcon,
        current: router.pathname.includes("/workflows"),
        disabled: !features?.workflows,
        trigger: "sidebar_workflows",
        plan: PlanEnum.DataRoomsPlus,
        highlightItem: ["workflows"],
      },
      {
        title: "Branding",
        url: "/branding",
        icon: BrushIcon,
        current:
          router.pathname.includes("branding") &&
          !router.pathname.includes("datarooms"),
      },
      {
        title: "General Settings",
        url: "/settings/general",
        icon: CogIcon,
        isActive:
          router.pathname.includes("settings") &&
          !router.pathname.includes("branding") &&
          !router.pathname.includes("datarooms") &&
          !router.pathname.includes("documents"),
        items: [
          {
            title: "General",
            url: "/settings/general",
            current: router.pathname.includes("settings/general"),
          },
          {
            title: "Team",
            url: "/settings/people",
            current: router.pathname.includes("settings/people"),
          },
          {
            title: "Domains",
            url: "/settings/domains",
            current: router.pathname.includes("settings/domains"),
          },
          {
            title: "Notifications",
            url: "/settings/notifications",
            current: router.pathname.includes("settings/notifications"),
          },
          {
            title: "Webhooks",
            url: "/settings/webhooks",
            current: router.pathname.includes("settings/webhooks"),
          },
          {
            title: "Slack",
            url: "/settings/slack",
            current: router.pathname.includes("settings/slack"),
          },
          ...(isAdmin
            ? [
                {
                  title: "Security",
                  url: "/settings/security",
                  current: router.pathname.includes("settings/security"),
                },
                {
                  title: "Billing",
                  url: "/settings/billing",
                  current: router.pathname.includes("settings/billing"),
                },
              ]
            : []),
        ],
      },
    ],
  };

  // Filter out items that should be hidden based on feature flags
  const filteredNavMain = data.navMain.filter((item) => {
    if (item.title === "Workflows" && !features?.workflows) {
      return false;
    }
    return true;
  });

  return (
    <>
      <SidebarHeader className="gap-y-0 pt-0">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm">
            <Loader className="h-5 w-5 animate-spin" /> Loading teams...
          </div>
        ) : (
          <TeamSwitcher
            currentTeam={currentTeam}
            teams={teams}
            setCurrentTeam={setCurrentTeam}
          />
        )}
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={filteredNavMain} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu className="group-data-[collapsible=icon]:hidden">
          <SidebarMenuItem>
            <div>
              {!slackIntegration && showSlackBanner ? (
                <SlackBanner setShowSlackBanner={setShowSlackBanner} />
              ) : null}
              {isFree && !isTrial && showProBanner ? (
                <ProBanner setShowProBanner={setShowProBanner} />
              ) : null}

              <div className="mb-2">
                {linksLimit ? (
                  <UsageProgress
                    title="Links"
                    unit="links"
                    usage={limits?.usage?.links}
                    usageLimit={linksLimit}
                  />
                ) : null}
                {documentsLimit ? (
                  <UsageProgress
                    title="Documents"
                    unit="documents"
                    usage={limits?.usage?.documents}
                    usageLimit={documentsLimit}
                  />
                ) : null}
                {linksLimit || documentsLimit ? (
                  <p className="mt-2 px-2 text-xs text-muted-foreground">
                    Change plan to increase usage limits
                  </p>
                ) : null}
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar
      className="bg-gray-50 dark:bg-black"
      sidebarClassName="bg-gray-50 dark:bg-black"
      side="left"
      variant="inset"
      collapsible="icon"
      {...props}
    >
      <AppSidebarContent />
    </Sidebar>
  );
}

function UsageProgress(data: {
  title: string;
  unit: string;
  usage?: number;
  usageLimit?: number;
}) {
  let { title, unit, usage, usageLimit } = data;
  let usagePercentage = 0;
  if (usage !== undefined && usageLimit !== undefined) {
    usagePercentage = (usage / usageLimit) * 100;
  }

  return (
    <div className="p-2">
      <div className="mt-1 flex flex-col space-y-1">
        {usage !== undefined && usageLimit !== undefined ? (
          <p className="text-xs text-foreground">
            <span>{nFormatter(usage)}</span> / {nFormatter(usageLimit)} {unit}
          </p>
        ) : (
          <div className="h-5 w-32 animate-pulse rounded-md bg-muted" />
        )}
        <Progress value={usagePercentage} className="h-1 bg-muted" max={100} />
      </div>
    </div>
  );
}
