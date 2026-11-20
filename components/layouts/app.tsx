import { useRouter } from "next/router";

import { useCallback, useEffect, useState } from "react";

import Cookies from "js-cookie";

import { useSelfMembership } from "@/lib/hooks/use-self-membership";

import { AppBreadcrumb } from "@/components/layouts/breadcrumb";
import { MobileBottomNav } from "@/components/layouts/mobile-bottom-nav";
import { MobileHeader } from "@/components/layouts/mobile-header";
import TrialBanner from "@/components/layouts/trial-banner";
import { SidebarPanels } from "@/components/sidebar/sidebar-panels";
import { Separator } from "@/components/ui/separator";
import {
  SIDEBAR_COOKIE_NAME,
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

import { BlockingModal } from "./blocking-modal";

const DEFAULT_SIDEBAR_OPEN = true;

// SSR and the first client render must return the same value to avoid a
// hydration mismatch; the cookie is only read after hydration.
let sidebarHydrated = false;

function getInitialSidebarState(isDataroom: boolean): boolean {
  if (typeof window === "undefined" || !sidebarHydrated) {
    return DEFAULT_SIDEBAR_OPEN;
  }

  if (isDataroom) {
    return true;
  }

  const mainCookie = Cookies.get(SIDEBAR_COOKIE_NAME);
  if (mainCookie !== undefined) {
    return mainCookie === "true";
  }

  return DEFAULT_SIDEBAR_OPEN;
}

/**
 * UX-only redirect guard for dataroom-scoped members. The API wrapper is the
 * real security boundary; this just keeps the scoped member from landing on
 * pages they cannot use. Redirects off non-dataroom paths and off datarooms
 * they are not assigned to, sending them to the datarooms list.
 */
function DataroomMemberRouteGuard() {
  const router = useRouter();
  const { isDataroomMember, allowedDataroomIds, loading } = useSelfMembership();

  useEffect(() => {
    if (loading || !isDataroomMember) return;

    const path = router.pathname;
    const onDataroomsArea =
      path === "/datarooms" || path.startsWith("/datarooms/[id]");

    if (!onDataroomsArea) {
      router.replace("/datarooms");
      return;
    }

    if (path.startsWith("/datarooms/[id]")) {
      const id = String(router.query.id || "");
      if (id && !allowedDataroomIds.includes(id)) {
        router.replace("/datarooms");
      }
    }
  }, [
    router,
    router.pathname,
    router.query.id,
    isDataroomMember,
    loading,
    allowedDataroomIds,
  ]);

  return null;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isDataroom = router.pathname.startsWith("/datarooms/[id]");

  const [sidebarOpen, setSidebarOpen] = useState(() =>
    getInitialSidebarState(isDataroom),
  );

  // Restore the persisted sidebar state after the first render has hydrated.
  useEffect(() => {
    sidebarHydrated = true;
    setSidebarOpen(getInitialSidebarState(isDataroom));
  }, [isDataroom]);

  const handleSidebarOpenChange = useCallback((open: boolean) => {
    setSidebarOpen(open);
  }, []);

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
      <DataroomMemberRouteGuard />
      {/* Single flex child of SidebarProvider so fixed mobile chrome is not laid out as extra row siblings (WebKit / in-app browsers). */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-x-1 overflow-x-hidden bg-gray-50 dark:bg-black md:flex-row">
          <Sidebar
            className="bg-gray-50 dark:bg-black"
            sidebarClassName="bg-gray-50 dark:bg-black"
            side="left"
            variant="inset"
            collapsible="icon"
          >
            <SidebarPanels />
          </Sidebar>
          <SidebarInset className="min-w-0 overflow-x-hidden ring-0 md:ring-1 md:ring-gray-200 md:dark:ring-gray-800">
            <header className="hidden h-10 shrink-0 items-center gap-2 md:flex">
              <div className="flex items-center gap-2 px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="mr-1 h-4" />
                <AppBreadcrumb />
              </div>
            </header>
            <TrialBanner />
            <BlockingModal />
            <main className="min-w-0 flex-1 overflow-x-hidden pt-[calc(3.5rem+env(safe-area-inset-top,0px))] pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pt-0 md:pb-0">
              {children}
            </main>
          </SidebarInset>
        </div>
        <MobileHeader />
        <MobileBottomNav />
      </div>
    </SidebarProvider>
  );
}
