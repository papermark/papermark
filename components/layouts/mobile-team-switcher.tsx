import { useState } from "react";

import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { Team } from "@/lib/types";
import { cn } from "@/lib/utils";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface MobileTeamSwitcherProps {
  currentTeam: Pick<Team, "id" | "name">;
  teams: Pick<Team, "id" | "name">[];
  onSwitch: (team: Pick<Team, "id" | "name">) => void;
}

export function MobileTeamSwitcher({
  currentTeam,
  teams,
  onSwitch,
}: MobileTeamSwitcherProps) {
  const [expanded, setExpanded] = useState(false);

  if (!currentTeam || !teams || teams.length === 0) return null;

  const hasMultipleTeams = teams.length > 1;

  return (
    <div className="mb-4">
      <div className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Team
      </div>
      <button
        type="button"
        onClick={() => (hasMultipleTeams ? setExpanded((v) => !v) : undefined)}
        disabled={!hasMultipleTeams}
        aria-expanded={hasMultipleTeams ? expanded : undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg border border-border px-3 py-3 text-left text-sm font-medium transition-colors",
          hasMultipleTeams ? "hover:bg-muted" : "cursor-default opacity-90",
        )}
      >
        <Avatar className="size-8 shrink-0 rounded">
          <AvatarFallback className="rounded text-xs">
            {currentTeam.name?.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate">{currentTeam.name}</span>
        {hasMultipleTeams && (
          <ChevronDownIcon
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        )}
      </button>
      {expanded && hasMultipleTeams && (
        <div className="mt-1 space-y-0.5 rounded-lg border border-border p-1">
          {teams.map((team) => {
            const isActive = team.id === currentTeam.id;
            return (
              <button
                key={team.id}
                type="button"
                onClick={() => {
                  setExpanded(false);
                  if (!isActive) onSwitch(team);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors",
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Avatar className="size-6 shrink-0 rounded text-[11px]">
                  <AvatarFallback className="rounded">
                    {team.name?.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate">{team.name}</span>
                {isActive && (
                  <CheckIcon className="h-4 w-4 shrink-0 text-foreground" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
