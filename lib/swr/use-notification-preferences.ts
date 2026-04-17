import { useTeam } from "@/context/team-context";
import useSWR from "swr";

import type {
  TeamNotificationFrequency,
  TeamNotificationScope,
  TeamNotificationType,
} from "@/lib/zod/schemas/notifications";
import { fetcher } from "@/lib/utils";

export type PreferenceEntry = {
  frequency: TeamNotificationFrequency;
  scope: TeamNotificationScope;
};

interface NotificationPreferencesResponse {
  preferences: Record<TeamNotificationType, PreferenceEntry>;
  role: string;
}

export function useNotificationPreferences() {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data, error, mutate } = useSWR<NotificationPreferencesResponse>(
    teamId ? `/api/teams/${teamId}/notifications/preferences` : null,
    fetcher,
    { dedupingInterval: 10000 },
  );

  const updatePreferences = async (
    preferences: {
      type: TeamNotificationType;
      frequency: TeamNotificationFrequency;
      scope?: TeamNotificationScope;
    }[],
  ) => {
    if (!teamId) return;

    const response = await fetch(
      `/api/teams/${teamId}/notifications/preferences`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences }),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to update notification preferences");
    }

    const result = await response.json();
    mutate(
      {
        ...data,
        preferences: result.preferences,
      } as NotificationPreferencesResponse,
      false,
    );
    return result;
  };

  return {
    preferences: data?.preferences,
    role: data?.role,
    isLoading: !data && !error,
    error,
    mutate,
    updatePreferences,
  };
}
