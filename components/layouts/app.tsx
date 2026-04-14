import { useRouter } from "next/router";

import { useCallback, useState } from "react";

import Cookies from "js-cookie";

import { AppBreadcrumb } from "@/components/layouts/breadcrumb";
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

function getInitialSidebarState(isDataroom: boolean): boolean {
  if (typeof window === "undefined") return false;

  if (isDataroom) {
    return true;
  }

  const mainCookie = Cookies.get(SIDEBAR_COOKIE_NAME);
  if (mainCookie !== undefined) {
    return mainCookie === "true";
  }

  return true;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isDataroom = router.pathname.startsWith("/datarooms/[id]");

  const [sidebarOpen, setSidebarOpen] = useState(() =>
    getInitialSidebarState(isDataroom),
  );

  const handleSidebarOpenChange = useCallback(
    (open: boolean) => {
      setSidebarOpen(open);
    },
    [],
  );

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
      <div className="flex min-w-0 flex-1 flex-col gap-x-1 bg-gray-50 dark:bg-black md:flex-row">
        <Sidebar
          className="bg-gray-50 dark:bg-black"
          sidebarClassName="bg-gray-50 dark:bg-black"
          side="left"
          variant="inset"
          collapsible="icon"
        >
          <SidebarPanels />
        </Sidebar>
        <SidebarInset className="min-w-0 ring-1 ring-gray-200 dark:ring-gray-800">
          <header className="flex h-10 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-1 h-4" />
              <AppBreadcrumb />
            </div>
          </header>
          <TrialBanner />
          <BlockingModal />
          <main className="min-w-0 flex-1">{children}</main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
