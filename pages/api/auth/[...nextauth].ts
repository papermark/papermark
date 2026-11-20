import { NextApiRequest, NextApiResponse } from "next";

import { checkRateLimit, rateLimiters } from "@/ee/features/security";
import { isSamlEnforcedForEmailDomain } from "@/lib/api/teams/is-saml-enforced-for-email-domain";
import NextAuth, { type NextAuthOptions } from "next-auth";

import { identifyUser, trackAnalytics } from "@/lib/analytics";
import { authOptions } from "@/lib/auth/auth-options";
import { dub } from "@/lib/dub";
import { isBlacklistedEmail } from "@/lib/edge-config/blacklist";
import prisma from "@/lib/prisma";
import { log } from "@/lib/utils";
import { getIpAddress } from "@/lib/utils/ip";

export { authOptions } from "@/lib/auth/auth-options";

// This function can run for a maximum of 180 seconds
export const config = {
  maxDuration: 180,
};

const getAuthOptions = (req: NextApiRequest): NextAuthOptions => {
  // ─── Shared state for the current auth request ───
  // The signIn callback runs BEFORE the user is created in the DB (for new
  // OAuth users), so `user.id` there may not be a valid database ID.
  // We capture the SAML tenant in the callback (where we have the raw
  // OAuthProfile with `requested.tenant`) and use it in the signIn event
  // (where `user.id` is guaranteed to be the real database ID).
  let samlTenant: string | null = null;
  let samlUserEmail: string | null = null;

  return {
    ...authOptions,
    callbacks: {
      ...authOptions.callbacks,
      signIn: async ({ user, account, profile }) => {
        if (!user.email || (await isBlacklistedEmail(user.email))) {
          await identifyUser(user.email ?? user.id);
          await trackAnalytics({
            event: "User Sign In Attempted",
            email: user.email ?? undefined,
            userId: user.id,
          });
          return false;
        }

        // ─── SSO Enforcement ───
        // If user is NOT signing in via SAML, check if their domain requires SSO
        if (
          account?.provider !== "saml" &&
          account?.provider !== "saml-idp"
        ) {
          try {
            const ssoEnforced = await isSamlEnforcedForEmailDomain(user.email);
            if (ssoEnforced) {
              throw new Error("require-saml-sso");
            }
          } catch (error) {
            console.error("[Auth] SSO enforcement check failed:", error);
            throw error;
          }
        }

        // ─── SAML user → email domain validation ───
        if (
          account?.provider === "saml" ||
          account?.provider === "saml-idp"
        ) {
          // Get the SAML profile — comes from different places depending on provider
          let samlProfile: any;
          if (account.provider === "saml-idp") {
            // IdP-initiated: we attached the Jackson userInfo to user.profile
            samlProfile = (user as any).profile;
          } else {
            // SP-initiated OAuth: NextAuth passes the raw Jackson userInfo as `profile`
            samlProfile = profile;
          }

          const tenant = samlProfile?.requested?.tenant;
          if (tenant) {
            // ─── Email domain validation ───
            // Verify the SAML user's email domain matches the team's ssoEmailDomain.
            // This prevents a misconfigured IdP from injecting users from unexpected domains.
            const team = await prisma.team.findUnique({
              where: { id: tenant },
              select: { ssoEmailDomain: true, id: true },
            });

            if (team?.ssoEmailDomain) {
              const userEmailDomain = user.email
                .split("@")[1]
                ?.toLowerCase();
              if (
                userEmailDomain !==
                team.ssoEmailDomain.toLowerCase()
              ) {
                console.warn(
                  `[SAML] Rejected: user ${user.email} domain does not match team ssoEmailDomain ${team.ssoEmailDomain}`,
                );
                return false;
              }
            }

            // Store tenant for the signIn event to handle auto-join.
            // We can't reliably do the userTeam upsert here because for
            // new users (or first-time SSO users), user.id is not yet a
            // valid database ID — NextAuth creates the user AFTER this
            // callback returns true.
            samlTenant = tenant;
            samlUserEmail = user.email;
          }
        }

        // Apply rate limiting for signin attempts
        try {
          if (req) {
            const clientIP = getIpAddress(req.headers);
            const rateLimitResult = await checkRateLimit(
              rateLimiters.auth,
              clientIP,
            );

            if (!rateLimitResult.success) {
              log({
                message: `Rate limit exceeded for IP ${clientIP} during signin attempt`,
                type: "error",
              });
              return false;
            }
          }
        } catch (error) {}

        return true;
      },
    },
    events: {
      ...authOptions.events,
      signIn: async (message) => {
        await Promise.allSettled([
          identifyUser(message.user.email ?? message.user.id),
          trackAnalytics({
            event: "User Signed In",
            email: message.user.email,
          }),
        ]);

        // ─── SAML: Auto-join workspace + clean up invitations ───
        // This runs AFTER the user is created in the DB, so message.user.id
        // is guaranteed to be the real database user ID.
        if (samlTenant) {
          const tenant = samlTenant;
          const userEmail = samlUserEmail;

          try {
            await prisma.userTeam.upsert({
              where: {
                userId_teamId: {
                  userId: message.user.id,
                  teamId: tenant,
                },
              },
              update: {},
              create: {
                userId: message.user.id,
                teamId: tenant,
                role: "MEMBER",
              },
            });
          } catch (error) {
            console.error(
              `[SAML] Failed to upsert userTeam for user ${message.user.id} in team ${tenant}:`,
              error,
            );
          }

          // Clean up any pending invitations for this user
          if (userEmail) {
            await prisma.invitation
              .deleteMany({
                where: {
                  email: userEmail,
                  teamId: tenant,
                },
              })
              .catch(() => {
                // No invitation to clean up
              });
          }
        }

        if (message.isNewUser) {
          const { dub_id } = req.cookies;
          if (dub_id && process.env.DUB_API_KEY) {
            try {
              await dub.track.lead({
                clickId: dub_id,
                eventName: "Sign Up",
                customerExternalId: message.user.id,
                customerName: message.user.name,
                customerEmail: message.user.email,
                customerAvatar: message.user.image ?? undefined,
              });
            } catch (err) {
              console.error("dub.track.lead failed", err);
            }
          }
        }
      },
    },
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  return NextAuth(req, res, getAuthOptions(req));
}
