"use client";

import Link from "next/link";
import { useRouter } from "next/router";

import { useEffect, useState } from "react";

import { PauseCircleIcon } from "lucide-react";
import { motion } from "motion/react";

import { usePlan } from "@/lib/swr/use-billing";

import { NavUser } from "@/components/sidebar/nav-user";
import { SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { BadgeTooltip } from "@/components/ui/tooltip";

import { AppSidebarContent } from "./app-sidebar";
import { DataroomSidebarContent } from "./dataroom-sidebar";

let lastKnownIsDataroom: boolean | null = null;

function SidebarBrandHeader() {
  const {
    plan: userPlan,
    isFree,
    isDataroomsPlus,
    isDataroomsPremium,
    isDataroomsUnlimited,
    isPaused,
    isTrial,
  } = usePlan();

  return (
    <SidebarHeader className="gap-y-0 pb-4">
      <p className="hidden w-full justify-center text-2xl font-bold tracking-tighter text-black group-data-[collapsible=icon]:inline-flex dark:text-white">
        <Link href="/dashboard">P</Link>
      </p>
      <p className="ml-2 flex items-center text-2xl font-bold tracking-tighter text-black group-data-[collapsible=icon]:hidden dark:text-white">
        <Link href="/dashboard">Papermark</Link>
        {userPlan && !isFree && !isDataroomsPlus && !isDataroomsPremium ? (
          <span className="relative ml-4 inline-flex items-center rounded-full bg-background px-2.5 py-1 text-xs tracking-normal text-foreground ring-1 ring-gray-800">
            {userPlan.charAt(0).toUpperCase() + userPlan.slice(1)}
            {isPaused ? (
              <BadgeTooltip content="Subscription paused">
                <PauseCircleIcon className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-background text-amber-500" />
              </BadgeTooltip>
            ) : null}
          </span>
        ) : null}
        {isDataroomsPlus && !isDataroomsPremium ? (
          <span className="relative ml-4 inline-flex items-center rounded-full bg-background px-2.5 py-1 text-xs tracking-normal text-foreground ring-1 ring-gray-800">
            Datarooms+
            {isPaused ? (
              <BadgeTooltip content="Subscription paused">
                <PauseCircleIcon className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-background text-amber-500" />
              </BadgeTooltip>
            ) : null}
          </span>
        ) : null}
        {isDataroomsPremium && !isDataroomsUnlimited ? (
          <span className="relative ml-4 inline-flex items-center rounded-full bg-background px-2.5 py-1 text-xs tracking-normal text-foreground ring-1 ring-gray-800">
            Premium
            {isPaused ? (
              <BadgeTooltip content="Subscription paused">
                <PauseCircleIcon className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-background text-amber-500" />
              </BadgeTooltip>
            ) : null}
          </span>
        ) : null}
        {isDataroomsUnlimited ? (
          <span className="relative ml-4 inline-flex items-center rounded-full bg-background px-2.5 py-1 text-xs tracking-normal text-foreground ring-1 ring-gray-800">
            Unlimited
            {isPaused ? (
              <BadgeTooltip content="Subscription paused">
                <PauseCircleIcon className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-background text-amber-500" />
              </BadgeTooltip>
            ) : null}
          </span>
        ) : null}
        {isTrial ? (
          <span className="ml-2 rounded-sm bg-foreground px-2 py-0.5 text-xs tracking-normal text-background ring-1 ring-gray-800">
            Trial
          </span>
        ) : null}
      </p>
    </SidebarHeader>
  );
}

export function SidebarPanels() {
  const router = useRouter();
  const isDataroom = router.pathname.startsWith("/datarooms/[id]");

  const [animDirection] = useState<"enter" | "leave" | null>(() => {
    if (lastKnownIsDataroom === null) return null;
    if (isDataroom && !lastKnownIsDataroom) return "enter";
    if (!isDataroom && lastKnownIsDataroom) return "leave";
    return null;
  });

  useEffect(() => {
    lastKnownIsDataroom = isDataroom;
  }, [isDataroom]);

  const [animating, setAnimating] = useState(animDirection !== null);

  if (animDirection) {
    return (
      <div className="flex h-full flex-col">
        <SidebarBrandHeader />
        <div
          className={`flex min-h-0 flex-1 flex-col ${animating ? "overflow-hidden" : ""}`}
        >
          <motion.div
            initial={{
              x: animDirection === "enter" ? "100%" : "-100%",
              opacity: 0,
            }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            onAnimationComplete={() => setAnimating(false)}
            className="flex min-h-0 flex-1 flex-col"
          >
            {isDataroom ? <DataroomSidebarContent /> : <AppSidebarContent />}
          </motion.div>
        </div>
        <SidebarFooter>
          <NavUser />
        </SidebarFooter>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <SidebarBrandHeader />
      {isDataroom ? <DataroomSidebarContent /> : <AppSidebarContent />}
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </div>
  );
}
