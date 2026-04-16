import { CircleHelpIcon, RotateCcwIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import PlanBadge from "@/components/billing/plan-badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BadgeTooltip, ButtonTooltip } from "@/components/ui/tooltip";

export default function LinkItem({
  title,
  enabled,
  action,
  isAllowed = true,
  requiredPlan,
  upgradeAction,
  resetAction,
  link,
  tooltipContent,
}: {
  title: string;
  enabled: boolean;
  action: () => void;
  isAllowed?: boolean;
  requiredPlan?: string;
  upgradeAction?: () => void;
  link?: string;
  resetAction?: () => void;
  tooltipContent?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-x-2">
      <div className="flex w-full items-center justify-between space-x-2">
        <h2
          className={cn(
            "flex flex-1 cursor-pointer flex-row items-center gap-2 text-sm font-medium leading-6",
            enabled ? "text-foreground" : "text-muted-foreground",
          )}
          onClick={isAllowed ? action : () => upgradeAction?.()}
        >
          <span>{title}</span>
          {!!tooltipContent && (
            <BadgeTooltip
              content={tooltipContent}
              key="link_tooltip"
              link={link}
            >
              <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
            </BadgeTooltip>
          )}
          {!isAllowed && requiredPlan ? (
            <PlanBadge plan={requiredPlan} />
          ) : null}
        </h2>
        {enabled && resetAction && (
          <ButtonTooltip content="Reset to defaults">
            <Button
              size="icon"
              variant="ghost"
              className="h-6"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                resetAction();
              }}
            >
              <RotateCcwIcon className="h-4 w-4" />
            </Button>
          </ButtonTooltip>
        )}
      </div>
      <Switch
        checked={enabled}
        onClick={isAllowed ? undefined : () => upgradeAction?.()}
        className={isAllowed ? undefined : "opacity-50"}
        onCheckedChange={isAllowed ? action : undefined}
      />
    </div>
  );
}
