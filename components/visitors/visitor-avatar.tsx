import { ArchiveIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { generateGravatarHash } from "@/lib/utils";
import { cn } from "@/lib/utils";

import { BadgeTooltip } from "../ui/tooltip";

function getAvatarFallbackUrl(seed: string): string {
  return `/api/og/avatar/${encodeURIComponent(seed)}`;
}

export const VisitorAvatar = ({
  viewerEmail,
  isArchived,
  className,
}: {
  viewerEmail: string | null;
  isArchived?: boolean;
  className?: string;
}) => {
  if (isArchived) {
    return (
      <BadgeTooltip
        key="archived"
        content="Visit is archived and excluded from the document statistics"
      >
        <Avatar
          className={cn("hidden flex-shrink-0 sm:inline-flex", className)}
        >
          <AvatarFallback className="bg-gray-200/50 dark:bg-gray-200/50">
            <ArchiveIcon className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      </BadgeTooltip>
    );
  }
  if (!viewerEmail) {
    return (
      <Avatar className={cn("hidden flex-shrink-0 sm:inline-flex", className)}>
        <AvatarImage src={getAvatarFallbackUrl("anonymous")} />
        <AvatarFallback className="bg-gray-200/50 dark:bg-gray-200/50">
          AN
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <Avatar
      className={cn(
        "hidden flex-shrink-0 border border-gray-200 dark:border-gray-800 sm:inline-flex",
        className,
      )}
    >
      <AvatarImage
        src={`https://gravatar.com/avatar/${generateGravatarHash(
          viewerEmail,
        )}?s=80&d=404`}
      />

      <AvatarFallback className="p-0">
        <img
          src={getAvatarFallbackUrl(viewerEmail)}
          alt={viewerEmail.slice(0, 2).toUpperCase()}
          className="h-full w-full"
        />
      </AvatarFallback>
    </Avatar>
  );
};
