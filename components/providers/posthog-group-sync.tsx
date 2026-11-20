import { useEffect, useRef } from "react";

import posthog from "posthog-js";

import { useTeam } from "@/context/team-context";
import { getPostHogConfig } from "@/lib/posthog";

/**
 * Syncs the current team to PostHog as a `team` group so that events
 * captured during the session are aggregated by team in Group Analytics.
 *
 * Must be rendered inside `<TeamProvider>` (which itself lives inside
 * `<PostHogCustomProvider>`).
 */
export function PostHogGroupSync() {
  const { currentTeam } = useTeam();
  const lastGroupKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!getPostHogConfig()) return;
    if (!currentTeam?.id) return;

    const properties: Record<string, unknown> = {};
    if (currentTeam.name) properties.name = currentTeam.name;
    if (currentTeam.plan) properties.plan = currentTeam.plan;
    if (currentTeam.createdAt) {
      properties.date_joined = new Date(currentTeam.createdAt).toISOString();
    }

    posthog.group("team", currentTeam.id, properties);
    lastGroupKeyRef.current = currentTeam.id;
  }, [
    currentTeam?.id,
    currentTeam?.name,
    currentTeam?.plan,
    currentTeam?.createdAt,
  ]);

  return null;
}
