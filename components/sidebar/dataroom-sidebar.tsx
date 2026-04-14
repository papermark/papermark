"use client";

import Link from "next/link";
import { useRouter } from "next/router";

import { useEffect, useRef, useState } from "react";

import {
  BarChart3Icon,
  BellIcon,
  BookOpenIcon,
  BrushIcon,
  ChevronLeftIcon,
  ChevronRight,
  CogIcon,
  DownloadIcon,
  FolderIcon,
  LinkIcon,
  LogsIcon,
  MessageSquareIcon,
  SendIcon,
  ShieldCheckIcon,
  ShieldIcon,
  TableIcon,
  UsersIcon,
} from "lucide-react";

import { useDataroom } from "@/lib/swr/use-dataroom";
import { cn } from "@/lib/utils";

import { DataroomLinkSheet } from "@/components/links/link-sheet/dataroom-link-sheet";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function ScrollingText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    const check = () => {
      const diff = text.scrollWidth - container.clientWidth;
      setOverflow(diff > 0 ? diff : 0);
    };
    check();

    const observer = new ResizeObserver(check);
    observer.observe(container);
    return () => observer.disconnect();
  }, [children]);

  const animate = overflow > 0 && hovered;

  return (
    <div
      ref={containerRef}
      className={cn("overflow-hidden", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        ref={textRef}
        className={cn(
          "inline-block whitespace-nowrap transition-transform duration-300 ease-in-out",
          !animate && "!translate-x-0",
        )}
        style={
          animate
            ? ({
                "--marquee-offset": `-${overflow}px`,
                transform: `translateX(var(--marquee-offset))`,
                transitionDuration: `${Math.max(overflow * 8, 600)}ms`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {children}
      </span>
    </div>
  );
}

export function DataroomSidebarContent() {
  const router = useRouter();
  const { dataroom } = useDataroom();
  const { state } = useSidebar();
  const dataroomId = dataroom?.id ?? (router.query.id as string);
  const [isLinkSheetOpen, setIsLinkSheetOpen] = useState(false);

  const navItems = [
    {
      title: "Documents",
      href: `/datarooms/${dataroomId}/documents`,
      icon: FolderIcon,
      segment: "documents",
    },
    {
      title: "Permissions",
      href: `/datarooms/${dataroomId}/permissions`,
      icon: ShieldCheckIcon,
      segment: "permissions",
      segments: ["permissions", "groups"],
      items: [
        {
          title: "Links",
          href: `/datarooms/${dataroomId}/permissions`,
          icon: LinkIcon,
        },
        {
          title: "Groups",
          href: `/datarooms/${dataroomId}/groups`,
          icon: UsersIcon,
        },
      ],
    },
    {
      title: "Analytics",
      href: `/datarooms/${dataroomId}/analytics`,
      icon: BarChart3Icon,
      segment: "analytics",
      items: [
        {
          title: "Overview",
          href: `/datarooms/${dataroomId}/analytics`,
          icon: TableIcon,
        },
        {
          title: "Audit Log",
          href: `/datarooms/${dataroomId}/analytics/audit-log`,
          icon: LogsIcon,
        },
      ],
    },
    {
      title: "Q&A",
      href: `/datarooms/${dataroomId}/conversations`,
      icon: MessageSquareIcon,
      segment: "conversations",
    },
    {
      title: "Branding",
      href: `/datarooms/${dataroomId}/branding`,
      icon: BrushIcon,
      segment: "branding",
    },
    {
      title: "Settings",
      href: `/datarooms/${dataroomId}/settings`,
      icon: CogIcon,
      segment: "settings",
      items: [
        {
          title: "General",
          href: `/datarooms/${dataroomId}/settings`,
          icon: CogIcon,
        },
        {
          title: "Introduction",
          href: `/datarooms/${dataroomId}/settings/introduction`,
          icon: BookOpenIcon,
        },
        {
          title: "Notifications",
          href: `/datarooms/${dataroomId}/settings/notifications`,
          icon: BellIcon,
        },
        {
          title: "Downloads",
          href: `/datarooms/${dataroomId}/settings/downloads`,
          icon: DownloadIcon,
        },
        {
          title: "File Permissions",
          href: `/datarooms/${dataroomId}/settings/file-permissions`,
          icon: ShieldIcon,
        },
      ],
    },
  ];

  const currentPath = router.asPath;

  const isItemActive = (item: (typeof navItems)[number]) => {
    const segments = item.segments ?? [item.segment];
    if (item.segment === "documents") {
      return (
        currentPath.includes(`/datarooms/${dataroomId}/documents`) ||
        currentPath === `/datarooms/${dataroomId}`
      );
    }
    return segments.some((seg) =>
      currentPath.includes(`/datarooms/${dataroomId}/${seg}`),
    );
  };

  return (
    <>
      <SidebarHeader className="gap-y-3 pt-0">
        <Link
          href="/datarooms"
          className="group/back flex items-center gap-2 rounded-lg text-foreground"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-transform duration-150 group-hover/back:-translate-x-0.5">
            <ChevronLeftIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <ScrollingText className="text-lg font-semibold leading-tight">
              {dataroom?.internalName || dataroom?.name || "Loading..."}
            </ScrollingText>
            {dataroom?.internalName && dataroom?.name ? (
              <p className="truncate text-xs text-muted-foreground">
                {dataroom.name}
              </p>
            ) : null}
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="w-full group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2"
                size="sm"
                onClick={() => setIsLinkSheetOpen(true)}
              >
                <span className="group-data-[collapsible=icon]:hidden">
                  Share dataroom
                </span>
                <SendIcon className="hidden !size-4 shrink-0 group-data-[collapsible=icon]:block" />
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              align="center"
              hidden={state !== "collapsed"}
            >
              Share dataroom
            </TooltipContent>
          </Tooltip>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarMenu className="space-y-0.5 text-foreground">
            {navItems.map((item) => {
              const active = isItemActive(item);
              const hasSubItems = item.items && item.items.length > 0;

              if (hasSubItems) {
                return (
                  <Collapsible key={item.title} asChild defaultOpen={active}>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        tooltip={item.title}
                        className={cn(
                          active &&
                            "rounded-md bg-gray-200 font-semibold dark:bg-secondary",
                        )}
                      >
                        <Link href={item.href}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuAction className="data-[state=open]:rotate-90">
                          <ChevronRight />
                          <span className="sr-only">Toggle</span>
                        </SidebarMenuAction>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub className="mr-0 pr-0">
                          {item.items!.map((subItem) => {
                            const isBaseSubItem = subItem.href === item.href;
                            const subActive = isBaseSubItem
                              ? currentPath === subItem.href
                              : currentPath === subItem.href ||
                                currentPath.startsWith(subItem.href + "/");
                            return (
                              <SidebarMenuSubItem
                                key={subItem.title}
                                className={cn(
                                  subActive &&
                                    "rounded-md bg-gray-200 font-semibold dark:bg-secondary",
                                )}
                              >
                                <SidebarMenuSubButton asChild>
                                  <Link href={subItem.href}>
                                    {subItem.icon && (
                                      <subItem.icon className="h-4 w-4" />
                                    )}
                                    <span>{subItem.title}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              }

              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                    className={cn(
                      active &&
                        "rounded-md bg-gray-200 font-semibold dark:bg-secondary",
                    )}
                  >
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <DataroomLinkSheet
        isOpen={isLinkSheetOpen}
        setIsOpen={setIsLinkSheetOpen}
        linkType="DATAROOM_LINK"
      />
    </>
  );
}
