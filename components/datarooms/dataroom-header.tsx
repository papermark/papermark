import Link from "next/link";

import { BellRingIcon, Loader2Icon, LockIcon, SnowflakeIcon } from "lucide-react";

import { useDataroom } from "@/lib/swr/use-dataroom";
import { useFreezeProgress } from "@/ee/features/dataroom-freeze/lib/swr/use-freeze-progress";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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

  const { isArchiveInProgress, progress, progressText } = useFreezeProgress({
    dataroomId: dataroom?.id,
    isFrozen: dataroom?.isFrozen ?? false,
    frozenAt: dataroom?.frozenAt ?? null,
    freezeArchiveUrl: dataroom?.freezeArchiveUrl ?? null,
  });

  return (
    <section className="mb-4">
      {dataroom?.isFrozen && isArchiveInProgress && (
        <div className="mb-3 space-y-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-950/50">
          <div className="flex items-center gap-2">
            <Loader2Icon className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
              Generating freeze archive...
            </span>
            <span className="ml-auto text-xs text-blue-600 dark:text-blue-400">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} className="h-1.5" />
          {progressText && (
            <p className="text-xs text-blue-600 dark:text-blue-400">
              {progressText}
            </p>
          )}
        </div>
      )}
      {dataroom?.isFrozen && !isArchiveInProgress && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 dark:border-blue-800 dark:bg-blue-950/50">
          <SnowflakeIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            This data room is frozen
          </span>
          <span className="text-sm text-blue-600/70 dark:text-blue-400/70">
            &mdash; no changes can be made and all viewer access has been
            revoked
          </span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex min-h-10 items-center gap-x-2 space-y-1">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {internalName || title}
              </h1>
              {dataroom?.isFrozen && (
                <SnowflakeIcon className="h-5 w-5 shrink-0 text-blue-500" />
              )}
            </div>
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
