import { NextApiRequest, NextApiResponse } from "next";

import { checkRateLimit, rateLimiters } from "@/ee/features/security";
import { isSamlEnforcedForEmailDomain } from "@/lib/api/teams/is-saml-enforced-for-email-domain";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import PasskeyProvider from "@teamhanko/passkeys-next-auth-provider";
import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";
import LinkedInProvider from "next-auth/providers/linkedin";

import { identifyUser, trackAnalytics } from "@/lib/analytics";
import { qstash } from "@/lib/cron";
import { dub } from "@/lib/dub";
import { isBlacklistedEmail } from "@/lib/edge-config/blacklist";
import { sendVerificationRequestEmail } from "@/lib/emails/send-verification-request";
import hanko from "@/lib/hanko";
import { jackson } from "@/lib/jackson";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";
import { getIpAddress } from "@/lib/utils/ip";

const VERCEL_DEPLOYMENT = !!process.env.VERCEL_URL;

function getMainDomainUrl(): string {
  if (process.env.NODE_ENV === "development") {
    return process.env.NEXTAUTH_URL || "http://localhost:3000";
  }
  return process.env.NEXTAUTH_URL || "https://app.papermark.com";
}

// This function can run for a maximum of 180 seconds
export const config = {
  maxDuration: 180,
};

export const authOptions: NextAuthOptions = {
  pages: {
    error: "/login",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      allowDangerousEmailAccountLinking: true,
    }),
    LinkedInProvider({
      clientId: process.env.LINKEDIN_CLIENT_ID as string,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET as string,
      authorization: {
        params: { scope: "openid profile email" },
      },
      issuer: "https://www.linkedin.com/oauth",
      jwks_endpoint: "https://www.linkedin.com/oauth/openid/jwks",
      profile(profile, tokens) {
        const defaultImage =
          "https://cdn-icons-png.flaticon.com/512/174/174857.png";
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture ?? defaultImage,
        };
      },
      allowDangerousEmailAccountLinking: true,
    }),
    EmailProvider({
      async sendVerificationRequest({ identifier, url }) {
        const hasValidNextAuthUrl = !!process.env.NEXTAUTH_URL;
        let finalUrl = url;

        if (!hasValidNextAuthUrl) {
          const mainDomainUrl = getMainDomainUrl();
          const urlObj = new URL(url);
          const mainDomainObj = new URL(mainDomainUrl);
          urlObj.hostname = mainDomainObj.hostname;
          urlObj.protocol = mainDomainObj.protocol;
          urlObj.port = mainDomainObj.port || "";

          finalUrl = urlObj.toString();
        }

        // In development, send the email but also log the URL
        if (process.env.NODE_ENV === "development") {
          await sendVerificationRequestEmail({
            url: finalUrl,
            email: identifier,
          });
          console.log("[Login Email Sent] Check your inbox for:", identifier);
        } else {
          await sendVerificationRequestEmail({
            url: finalUrl,
            email: identifier,
          });
        }
      },
    }),
    PasskeyProvider({
      tenant: hanko,
      async authorize({ userId }) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return null;
        return user;
      },
    }),
    // ─── SP-Initiated SAML SSO (OAuth flow with PKCE + state) ───
    // Used when user clicks "Continue with SSO" on the login page.
    // NextAuth handles PKCE and state validation automatically.
    {
      id: "saml",
      name: "BoxyHQ SAML",
      type: "oauth",
      version: "2.0",
      checks: ["pkce", "state"],
      authorization: {
        url: `${process.env.NEXTAUTH_URL}/api/auth/saml/authorize`,
        params: {
          scope: "",
          response_type: "code",
          provider: "saml",
        },
      },
      token: {
        url: `${process.env.NEXTAUTH_URL}/api/auth/saml/token`,
        params: { grant_type: "authorization_code" },
      },
      userinfo: `${process.env.NEXTAUTH_URL}/api/auth/saml/userinfo`,
      profile: async (profile) => {
        // Return the normalized profile and let PrismaAdapter.createUser
        // handle user creation so the createUser event fires correctly
        // (welcome emails, analytics, etc.)
        const name =
          `${profile.firstName || ""} ${profile.lastName || ""}`.trim() ||
          null;

        return {
          id: profile.id || profile.email,
          name,
          email: profile.email,
          image: null,
        };
      },
      options: {
        clientId: "dummy",
        clientSecret: process.env.NEXTAUTH_SECRET as string,
      },
      allowDangerousEmailAccountLinking: true,
    },
    // ─── IdP-Initiated SAML SSO (Credentials provider) ───
    // Used when user clicks the app tile in their IdP dashboard.
    // Jackson redirects with a code to /auth/saml, which then calls signIn("saml-idp", { code }).
    CredentialsProvider({
      id: "saml-idp",
      name: "IdP Login",
      credentials: {
        code: { type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.code) return null;

        try {
          const { oauthController } = await jackson();

          const { access_token } = await oauthController.token({
            code: credentials.code,
            grant_type: "authorization_code",
            redirect_uri: process.env.NEXTAUTH_URL!,
            client_id: "dummy",
            client_secret: process.env.NEXTAUTH_SECRET!,
          });

          if (!access_token) return null;

          const userInfo = await oauthController.userInfo(access_token);
          if (!userInfo) return null;

          const { email, firstName, lastName, requested } = userInfo as any;
          if (!email) return null;

          const name = [firstName, lastName].filter(Boolean).join(" ") || email;

          const user = await prisma.user.upsert({
            where: { email },
            create: { email, name },
            update: { name: name || undefined },
          });

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            // Pass profile for signIn callback to access tenant
            profile: userInfo,
          } as any;
        } catch (error) {
          console.error("[SAML] Error during SAML authorization:", error);
          return null;
        }
      },
    }),
  ],
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  cookies: {
    sessionToken: {
      name: `${VERCEL_DEPLOYMENT ? "__Secure-" : ""}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        domain: VERCEL_DEPLOYMENT ? ".papermark.com" : undefined,
        secure: VERCEL_DEPLOYMENT,
      },
    },
  },
  callbacks: {
    jwt: async (params) => {
      const { token, user, trigger, account } = params;
      if (!token.email) {
        return {};
      }
      if (user) {
        token.user = user;
      }
      // Track SAML provider on the token
      if (
        (account?.provider === "saml" || account?.provider === "saml-idp") &&
        user
      ) {
        token.provider = "saml";
      }
      // refresh the user data
      if (trigger === "update") {
        const user = token?.user as CustomUser;
        const refreshedUser = await prisma.user.findUnique({
          where: { id: user.id },
        });
        if (refreshedUser) {
          token.user = refreshedUser;
        } else {
          return {};
        }

        if (refreshedUser?.email !== user.email) {
          if (user.id && refreshedUser.email) {
            await prisma.account.deleteMany({
              where: { userId: user.id },
            });
          }
        }
      }
      return token;
    },
    session: async ({ session, token }) => {
      (session.user as CustomUser) = {
        id: token.sub,
        // @ts-ignore
        ...(token || session).user,
      };
      return session;
    },
  },
  events: {
    async createUser(message) {
      await identifyUser(message.user.email ?? message.user.id);
      await trackAnalytics({
        event: "User Signed Up",
        email: message.user.email,
        userId: message.user.id,
      });

      await qstash.publishJSON({
        url: `${process.env.NEXT_PUBLIC_BASE_URL}/api/cron/welcome-user`,
        body: {
          userId: message.user.id,
        },
        delay: 15 * 60,
      });
    },
  },
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
            if (error instanceof Error && error.message === "require-saml-sso") {
              throw error;
            }
            console.error("[Auth] SSO enforcement check failed:", error);
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
