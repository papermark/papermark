import { useTeam } from "@/context/team-context";

export type PermissionStrategy =
  | "INHERIT_FROM_PARENT"
  | "ASK_EVERY_TIME"
  | "HIDDEN_BY_DEFAULT";

export const useDataroomPermissions = () => {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const applyPermissions = async (
    dataroomId: string,
    documentIds: string[],
    strategies:
      | PermissionStrategy
      | {
          groupStrategy?: PermissionStrategy;
          linkStrategy?: PermissionStrategy;
        },
    folderPath?: string,
    onError?: (message: string) => void,
  ): Promise<{ success: boolean; error?: string }> => {
    if (!teamId) {
      return { success: false, error: "Team ID not available" };
    }

    if (!documentIds || documentIds.length === 0) {
      return { success: false, error: "No document IDs provided" };
    }

    // Accept either a legacy single-strategy string (applied to both targets
    // server-side for backward compat) or per-target strategies.
    const body =
      typeof strategies === "string"
        ? {
            documentIds,
            strategy: strategies,
            folderPath,
          }
        : {
            documentIds,
            groupStrategy: strategies.groupStrategy,
            linkStrategy: strategies.linkStrategy,
            folderPath,
          };

    try {
      const response = await fetch(
        `/api/teams/${encodeURIComponent(teamId)}/datarooms/${encodeURIComponent(dataroomId)}/apply-permissions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        onError?.(errorData.message || `HTTP ${response.status}`);
        return {
          success: false,
          error: errorData.message || `HTTP ${response.status}`,
        };
      }

      return { success: true };
    } catch (error) {
      console.error("Failed to apply permissions:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      onError?.(errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  };

  return {
    applyPermissions,
  };
};
