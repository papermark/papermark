import Link from "next/link";

import { BellRingIcon, LockIcon } from "lucide-react";

import { useDataroom } from "@/lib/swr/use-dataroom";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const DataroomHeader = ({
  title,
  description,
  internalName,
  actions,
}: {
  title: string;
  description: string;
  internalName?: string | null;
  actions?: React.ReactNode[];
}) => {
  const { dataroom } = useDataroom();

  return (
    <section className="mb-4">
      {dataroom?.isFrozen && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2.5">
          <LockIcon className="h-4 w-4 text-destructive" />
          <span className="text-sm font-medium text-destructive">
            This data room is frozen
          </span>
          <span className="text-sm text-muted-foreground">
            &mdash; all viewer access has been revoked
          </span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex min-h-10 items-center gap-x-2 space-y-1">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {internalName || title}
            </h1>
            {internalName && (
              <p className="text-sm text-muted-foreground">{title}</p>
            )}
          </div>
          {dataroom?.enableChangeNotifications ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={`/datarooms/${dataroom?.id}/settings/notifications`}
                >
                  <Button variant="ghost" size="icon" className="size-8">
                    <BellRingIcon className="inline-block !size-4 text-[#fb7a00]" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent
                  side="right"
                  className="text-center text-muted-foreground"
                >
                  <p>Change notifications are enabled</p>
                </TooltipContent>
              </TooltipPortal>
            </Tooltip>
          ) : null}
        </div>
        {actions && actions.length > 0 ? (
          <div className="flex items-center gap-2">
            {actions.map((action, i) => (
              <div key={i}>{action}</div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
};
