import Link from "next/link";
import { useRouter } from "next/router";

import { useState } from "react";

import {
  BarChart3Icon,
  FolderIcon,
  HouseIcon,
  MoreHorizontalIcon,
  ServerIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { usePlan } from "@/lib/swr/use-billing";
import { PlanEnum } from "@/ee/stripe/constants";
import { cn } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";

import { MobileDataroomMoreMenu } from "./mobile-dataroom-more-menu";
import { MobileMoreMenu } from "./mobile-more-menu";
import { MobileShareFab } from "./mobile-share-fab";

export function MobileBottomNav() {
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const { isBusiness, isDatarooms, isDataroomsPlus, isTrial } = usePlan();

  const dataroomsEnabled =
    isBusiness || isDatarooms || isDataroomsPlus || isTrial;

  const dataroomId = router.query.id as string | undefined;
  const inDataroomDetail =
    router.pathname.startsWith("/datarooms/[id]") && !!dataroomId;

  const isActive = (match: string) => {
    if (match === "documents") {
      return (
        router.pathname.includes("documents") &&
        !router.pathname.includes("datarooms")
      );
    }
    return router.pathname.includes(match);
  };

  const moreIsActive =
    !["dashboard", "documents", "datarooms"].some((m) => isActive(m));

  const tabClass = (active: boolean) =>
    cn(
      "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors",
      active
        ? "text-foreground"
        : "text-muted-foreground hover:text-foreground",
    );

  const documentsTabActive =
    inDataroomDetail &&
    (router.pathname === "/datarooms/[id]" ||
      router.pathname.startsWith("/datarooms/[id]/documents"));

  const permissionsTabActive =
    inDataroomDetail &&
    ((router.pathname.includes("permissions") &&
      !router.pathname.includes("settings")) ||
      router.pathname.includes("/groups"));

  const analyticsTabActive =
    inDataroomDetail &&
    router.pathname.includes("analytics") &&
    !router.pathname.includes("/groups");

  const dataroomMoreTabActive =
    inDataroomDetail &&
    !documentsTabActive &&
    !permissionsTabActive &&
    !analyticsTabActive;

  if (inDataroomDetail && dataroomId) {
    const base = `/datarooms/${dataroomId}`;
    return (
      <>
        <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background pb-[env(safe-area-inset-bottom,0px)] [-webkit-tap-highlight-color:transparent] touch-manipulation md:hidden">
          <div className="flex min-h-[4.5rem] items-end justify-between gap-0.5 px-0.5">
            <Link
              href={`${base}/documents`}
              className={tabClass(!!documentsTabActive)}
            >
              <FolderIcon className="h-6 w-6" />
              <span>Documents</span>
            </Link>
            <Link
              href={`${base}/permissions`}
              className={tabClass(!!permissionsTabActive)}
            >
              <ShieldCheckIcon className="h-6 w-6" />
              <span>Permissions</span>
            </Link>
            <div className="flex w-12 shrink-0 items-center justify-center self-center">
              <MobileShareFab mode="dataroom" dataroomId={dataroomId} />
            </div>
            <Link
              href={`${base}/analytics`}
              className={tabClass(!!analyticsTabActive)}
            >
              <BarChart3Icon className="h-6 w-6" />
              <span>Analytics</span>
            </Link>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={tabClass(!!dataroomMoreTabActive)}
            >
              <MoreHorizontalIcon className="h-6 w-6" />
              <span>More</span>
            </button>
          </div>
        </nav>

        <MobileDataroomMoreMenu
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          dataroomId={dataroomId}
        />
      </>
    );
  }

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background pb-[env(safe-area-inset-bottom,0px)] [-webkit-tap-highlight-color:transparent] touch-manipulation md:hidden">
        <div className="flex min-h-[4.5rem] items-end justify-between gap-0.5 px-0.5">
          <Link href="/dashboard" className={tabClass(isActive("dashboard"))}>
            <HouseIcon className="h-6 w-6" />
            <span>Dashboard</span>
          </Link>
          <Link href="/documents" className={tabClass(isActive("documents"))}>
            <FolderIcon className="h-6 w-6" />
            <span>Documents</span>
          </Link>
          <div className="flex w-12 shrink-0 items-center justify-center self-center">
            <MobileShareFab mode="global" />
          </div>
          {dataroomsEnabled ? (
            <Link href="/datarooms" className={tabClass(isActive("datarooms"))}>
              <ServerIcon className="h-6 w-6" />
              <span>Datarooms</span>
            </Link>
          ) : (
            <UpgradePlanModal
              clickedPlan={PlanEnum.Business}
              trigger="mobile_nav_datarooms"
              highlightItem={["datarooms"]}
            >
              <button type="button" className={tabClass(false)}>
                <ServerIcon className="h-6 w-6" />
                <span>Datarooms</span>
              </button>
            </UpgradePlanModal>
          )}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={tabClass(moreIsActive)}
          >
            <MoreHorizontalIcon className="h-6 w-6" />
            <span>More</span>
          </button>
        </div>
      </nav>

      <MobileMoreMenu open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
