import Image from "next/image";
import Link from "next/link";

import { useState } from "react";

import { HelpCircle, LogOut, Search } from "lucide-react";
import { FileText } from "lucide-react";
import { signOut, useSession } from "next-auth/react";

import { cn } from "@/lib/utils";

import ChevronUp from "@/components/shared/icons/chevron-up";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

import { SearchCommand } from "./search-command";
import { ModeToggle } from "./theme-toggle";

type ProfileMenuProps = {
  className?: string;
  size: "large" | "small";
};

// Define the Article interface
interface Article {
  data: {
    slug: string;
    title: string;
    description?: string;
  };
}

const ProfileMenu = ({ className, size }: ProfileMenuProps) => {
  const { data: session, status } = useSession();
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

      console.log("Fetching articles..."); // Debug log
      const res = await fetch(`/api/help?${params}`);
      const data = await res.json();

      console.log("Received data:", data); // Debug log

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

  const isSize = size === "large";
  return (
    <>
      <div className="flex items-center justify-between space-x-2">
        {status === "loading" ? (
          <div className="flex w-full items-center gap-x-3 rounded-md p-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            {isSize && <Skeleton className="h-7 w-[90%]" />}
          </div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild className="w-full">
              <div className="group flex w-full items-center rounded-full text-sm font-semibold leading-6 text-foreground hover:bg-gray-200 hover:dark:bg-secondary lg:gap-x-3 lg:rounded-md lg:p-2">
                {session?.user?.image ? (
                  <Image
                    className="h-7 w-7 rounded-full bg-secondary"
                    src={session?.user?.image}
                    width={30}
                    height={30}
                    alt={`Profile picture of ${session?.user?.name}`}
                    loading="lazy"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="h-7 w-7 rounded-full"
                    src={`/api/og/avatar/${encodeURIComponent(session?.user?.email || session?.user?.name || "user")}`}
                    alt={`Profile picture of ${session?.user?.name || "user"}`}
                    width={30}
                    height={30}
                  />
                )}
                {isSize && (
                  <span className="flex w-full items-center justify-between">
                    <span className="sr-only">Your profile</span>
                    <span aria-hidden="true" className="line-clamp-2">
                      {session?.user?.name
                        ? session?.user?.name
                        : session?.user?.email?.split("@")[0]}
                    </span>
                    <ChevronUp
                      className="ml-2 h-5 w-5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </span>
                )}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="mr-2 px-0 pb-2 lg:mr-0 lg:w-[240px] xl:w-[270px]">
              {session ? (
                <>
                  <DropdownMenuLabel className="mt-2 truncate !py-[3px] px-3 text-sm text-muted-foreground">
                    {session?.user?.email}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="!my-2" />
                  <ModeToggle />

                  <button
                    onClick={() => {
                      setSearchOpen(true);
                      fetchArticles();
                    }}
                    className="flex w-full items-center px-3 py-2 text-sm duration-200 hover:bg-gray-200 dark:hover:bg-muted"
                  >
                    <Search className="mr-2 h-4 w-4" />
                    Need help?
                  </button>

                  <a
                    href="mailto:support@papermark.com"
                    className="my-1 flex items-center px-3 py-2 text-sm duration-200 hover:bg-gray-200 dark:hover:bg-muted"
                  >
                    <HelpCircle className="mr-2 h-4 w-4" />
                    Contact us
                  </a>

                  <Link
                    onClick={() =>
                      signOut({
                        callbackUrl: `${window.location.origin}`,
                      })
                    }
                    className="flex items-center px-3 py-2 text-sm duration-200 hover:bg-gray-200 dark:hover:bg-muted"
                    href={""}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign Out
                  </Link>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

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
                    <FileText className="mr-2 h-4 w-4 text-[#fb7a00]" />
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
};

export default ProfileMenu;
