"use client";

import Link from "next/link";

import { useState } from "react";

import {
  ChevronsUpDown,
  CircleUserRound,
  FileTextIcon,
  LifeBuoyIcon,
  LogOut,
  MailIcon,
} from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

import { ModeToggle } from "../theme-toggle";

interface Article {
  data: {
    slug: string;
    title: string;
    description?: string;
  };
}

export function NavUser() {
  const { data: session, status } = useSession();
  const { isMobile } = useSidebar();

  const [searchOpen, setSearchOpen] = useState(false);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchArticles = async (query?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        locale: "en", // or get this from your app's locale
        ...(query && { q: query }),
      });

      const res = await fetch(`/api/help?${params}`);
      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      setArticles(data.articles || []);
    } catch (error) {
      console.error("Error fetching articles:", error);
      setArticles([]); // Set empty array on error
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage
                    src={
                      session?.user?.image ||
                      `/api/og/avatar/${encodeURIComponent(session?.user?.email || session?.user?.name || "user")}`
                    }
                    alt={session?.user?.name || ""}
                  />
                  <AvatarFallback className="rounded-lg">
                    {session?.user?.name?.charAt(0) ||
                      session?.user?.email?.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {session?.user?.name || ""}
                  </span>
                  <span className="truncate text-xs">
                    {session?.user?.email || ""}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage
                      src={
                        session?.user?.image ||
                        `/api/og/avatar/${encodeURIComponent(session?.user?.email || session?.user?.name || "user")}`
                      }
                      alt={session?.user?.name || ""}
                    />
                    <AvatarFallback className="rounded-lg">
                      {session?.user?.name?.charAt(0) ||
                        session?.user?.email?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {session?.user?.name || ""}
                    </span>
                    <span className="truncate text-xs">
                      {session?.user?.email || ""}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <ModeToggle />
              <DropdownMenuGroup>
                <Link href="/account/general">
                  <DropdownMenuItem>
                    <CircleUserRound />
                    User Settings
                  </DropdownMenuItem>
                </Link>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    setSearchOpen(true);
                    fetchArticles();
                  }}
                >
                  <LifeBuoyIcon />
                  Help Center
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    navigator.clipboard.writeText("support@papermark.com");
                    toast.success("support@papermark.com copied to clipboard");
                  }}
                >
                  <MailIcon />
                  Contact Support
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  signOut({
                    callbackUrl: `${window.location.origin}`,
                  })
                }
              >
                <LogOut />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-[550px] gap-0 overflow-hidden border-none p-0 shadow-lg">
          <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
            <CommandInput
              placeholder="Search help articles..."
              className="h-14 border-none px-4 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              onValueChange={(search) => fetchArticles(search)}
            />
            <CommandList className="max-h-[400px] overflow-y-auto">
              <CommandEmpty>No articles found</CommandEmpty>
              <CommandGroup heading="All Articles">
                {articles.map((article) => (
                  <CommandItem
                    key={article.data.slug}
                    value={article.data.title}
                    onSelect={() => {
                      window.open(
                        `${process.env.NEXT_PUBLIC_MARKETING_URL}/help/article/${article.data.slug}`,
                        "_blank",
                      );
                      setSearchOpen(false);
                    }}
                  >
                    <FileTextIcon className="mr-2 h-4 w-4 text-[#fb7a00]" />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {article.data.title}
                      </span>
                      {article.data.description && (
                        <span className="text-xs text-muted-foreground">
                          {article.data.description}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
