import { z } from "zod";

const MAX_CUSTOM_MESSAGE_LENGTH = 500;
export const MAX_INVITATION_EMAILS_PER_REQUEST = 10;
export const MAX_INVITATION_EMAILS_PER_DAY = 50;

export const invitationEmailSchema = z.string().email();

const trimmedCustomMessageSchema = z
  .string()
  .max(MAX_CUSTOM_MESSAGE_LENGTH)
  .transform((value) => value.trim());

export const optionalCustomMessageSchema = z
  .union([trimmedCustomMessageSchema, z.literal(""), z.undefined(), z.null()])
  .transform((value) => {
    if (typeof value !== "string") {
      return undefined;
    }

    return value.length > 0 ? value : undefined;
  });

export const sendGroupInvitationSchema = z.object({
  linkId: z.string().min(1),
  customMessage: optionalCustomMessageSchema,
  emails: z.array(invitationEmailSchema).max(MAX_INVITATION_EMAILS_PER_REQUEST).optional(),
});

export const sendLinkInvitationSchema = z.object({
  customMessage: optionalCustomMessageSchema,
  emails: z.array(invitationEmailSchema).max(MAX_INVITATION_EMAILS_PER_REQUEST).optional(),
});

export const SendGroupInvitationSchema = sendGroupInvitationSchema;
export const SendLinkInvitationSchema = sendLinkInvitationSchema;

export type SendGroupInvitationInput = z.infer<typeof sendGroupInvitationSchema>;
export type SendLinkInvitationInput = z.infer<typeof sendLinkInvitationSchema>;

