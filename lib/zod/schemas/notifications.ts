import { z } from "zod";

// --- Viewer notification preferences (external viewers for dataroom change notifications) ---

export const ViewerNotificationFrequency = z.enum([
  "instant",
  "daily",
  "weekly",
]);
export type ViewerNotificationFrequency = z.infer<
  typeof ViewerNotificationFrequency
>;

/** @deprecated Use ViewerNotificationFrequency instead */
export const NotificationFrequency = ViewerNotificationFrequency;
/** @deprecated Use ViewerNotificationFrequency instead */
export type NotificationFrequency = ViewerNotificationFrequency;

export const ZViewerNotificationPreferencesSchema = z
  .object({
    dataroom: z.record(
      z.object({
        enabled: z.boolean(),
        frequency: ViewerNotificationFrequency.optional().default("instant"),
      }),
    ),
  })
  .optional()
  .default({ dataroom: {} });

export const ZUserNotificationPreferencesSchema = z
  .object({
    yearInReview: z.object({
      enabled: z.boolean(),
    }),
  })
  .optional()
  .default({ yearInReview: { enabled: true } });

// --- Team member notification preferences ---

export const TeamNotificationType = z.enum([
  "DOCUMENT_VIEW",
  "DATAROOM_VIEW",
  "BLOCKED_ACCESS",
  "DATAROOM_UPLOAD",
  "CONVERSATION_MESSAGE",
]);
export type TeamNotificationType = z.infer<typeof TeamNotificationType>;
export const TEAM_NOTIFICATION_TYPES = TeamNotificationType.options;

export const TeamNotificationFrequency = z.enum(["IMMEDIATE", "NEVER"]);
export type TeamNotificationFrequency = z.infer<
  typeof TeamNotificationFrequency
>;

export const TeamNotificationScope = z.enum(["ALL", "MINE_ONLY"]);
export type TeamNotificationScope = z.infer<typeof TeamNotificationScope>;

export const ZNotificationPreferenceSchema = z.object({
  type: TeamNotificationType,
  frequency: TeamNotificationFrequency,
  scope: TeamNotificationScope.optional(),
});

export const ZUpdateNotificationPreferencesSchema = z.object({
  preferences: z.array(ZNotificationPreferenceSchema).min(1),
});

export type NotificationPreferenceDefaults = {
  frequency: TeamNotificationFrequency;
  scope: TeamNotificationScope;
};

export const DEFAULT_ADMIN_PREFERENCES: Record<
  TeamNotificationType,
  NotificationPreferenceDefaults
> = {
  DOCUMENT_VIEW: { frequency: "IMMEDIATE", scope: "ALL" },
  DATAROOM_VIEW: { frequency: "IMMEDIATE", scope: "ALL" },
  BLOCKED_ACCESS: { frequency: "IMMEDIATE", scope: "ALL" },
  DATAROOM_UPLOAD: { frequency: "IMMEDIATE", scope: "ALL" },
  CONVERSATION_MESSAGE: { frequency: "IMMEDIATE", scope: "ALL" },
};

export const DEFAULT_MEMBER_PREFERENCES: Record<
  TeamNotificationType,
  NotificationPreferenceDefaults
> = {
  DOCUMENT_VIEW: { frequency: "IMMEDIATE", scope: "MINE_ONLY" },
  DATAROOM_VIEW: { frequency: "IMMEDIATE", scope: "MINE_ONLY" },
  BLOCKED_ACCESS: { frequency: "IMMEDIATE", scope: "MINE_ONLY" },
  DATAROOM_UPLOAD: { frequency: "IMMEDIATE", scope: "MINE_ONLY" },
  CONVERSATION_MESSAGE: { frequency: "NEVER", scope: "MINE_ONLY" },
};
