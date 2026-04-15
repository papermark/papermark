import { jackson } from "@/lib/jackson";
import prisma from "@/lib/prisma";
import type { DirectorySyncEvent } from "@boxyhq/saml-jackson";
import { createHash } from "crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Return a truncated SHA-256 hex digest (first 12 chars) for log-safe pseudonymisation. */
function hashEmail(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 12);
}

const handler = async (
  req: Request,
  { params }: { params: Promise<{ directory: string[] }> },
) => {
  try {
    const resolvedParams = await params;
    const headersList = await headers();
    const authHeader = headersList.get("Authorization");
    const apiSecret = authHeader ? authHeader.split(" ")[1] : null;

    const url = new URL(req.url);
    const query = Object.fromEntries(url.searchParams.entries());

    const [directoryId, path, resourceId] = resolvedParams.directory;

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { directorySyncController } = await jackson();

    const request = {
      method: req.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      body,
      directoryId,
      resourceId,
      resourceType: (path === "Users" ? "users" : "groups") as
        | "users"
        | "groups",
      apiSecret,
      query: {
        count: query.count ? parseInt(query.count) : undefined,
        startIndex: query.startIndex ? parseInt(query.startIndex) : undefined,
        filter: query.filter as string,
      },
    };

    const { status, data } = await directorySyncController.requests.handle(
      request,
      handleSCIMEvents,
    );

    return NextResponse.json(data, { status });
  } catch (error: any) {
    console.error("[SCIM] Request error:", error);
    return NextResponse.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "Internal server error",
        status: 500,
      },
      { status: 500 },
    );
  }
};

export {
  handler as DELETE,
  handler as GET,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};

// ──────────────────────────────────────────────────────────
// SCIM Event Handler — sync changes to the main app DB
// ──────────────────────────────────────────────────────────
async function handleSCIMEvents(event: DirectorySyncEvent) {
  const { event: eventType, data, tenant } = event;

  // Verify the team exists and has SSO enabled
  const team = await prisma.team.findUnique({
    where: { id: tenant },
    select: { id: true, plan: true, ssoEnabled: true },
  });

  if (!team || !team.ssoEnabled) {
    console.warn(
      `[SCIM] Ignoring event for tenant ${tenant} — SSO not enabled`,
    );
    return;
  }

  // Plan gate: only datarooms-premium or higher
  const allowedPlans = ["datarooms-premium", "datarooms-premium+old", "datarooms-unlimited", "datarooms-unlimited+old"];
  if (!allowedPlans.includes(team.plan)) {
    console.warn(
      `[SCIM] Ignoring event for tenant ${tenant} — plan ${team.plan} not eligible`,
    );
    return;
  }

  if (!("email" in data) || !data.email) {
    return;
  }

  // Normalize once so look-ups/upserts always use a consistent lowercase key
  const email = data.email.trim().toLowerCase();

  try {
    switch (eventType) {
      case "user.created": {
        console.log(
          `[SCIM] User created: user_${hashEmail(email)} for tenant ${tenant}`,
        );

        const user = await prisma.user.upsert({
          where: { email },
          create: {
            email,
            name: [data.first_name, data.last_name].filter(Boolean).join(" "),
          },
          update: {},
        });

        await prisma.userTeam.upsert({
          where: {
            userId_teamId: {
              userId: user.id,
              teamId: tenant,
            },
          },
          update: {},
          create: {
            userId: user.id,
            teamId: tenant,
            role: "MEMBER",
          },
        });
        break;
      }

      case "user.updated": {
        console.log(
          `[SCIM] User updated: user_${hashEmail(email)} for tenant ${tenant}`,
        );

        // Handle Azure AD's active/inactive (can be boolean or string in any casing)
        const rawActive = (data as any).active;
        const normalizedActive =
          rawActive === undefined
            ? undefined
            : typeof rawActive === "string"
              ? rawActive.toLowerCase() === "true"
              : Boolean(rawActive);

        const isActive = normalizedActive === true;
        const isInactive = normalizedActive === false;

        if (isInactive) {
          // Deactivated — remove from team (same as user.deleted)
          const user = await prisma.user.findUnique({
            where: { email },
          });

          if (user) {
            await Promise.all([
              prisma.link
                .updateMany({
                  where: {
                    teamId: tenant,
                    ownerId: user.id,
                  },
                  data: {
                    ownerId: null,
                  },
                })
                .catch(() => {
                  console.warn(
                    `[SCIM] Could not reset link ownership for user_${hashEmail(email)}`,
                  );
                }),
              prisma.userTeam
                .delete({
                  where: {
                    userId_teamId: {
                      userId: user.id,
                      teamId: tenant,
                    },
                  },
                })
                .catch(() => {
                  console.warn(
                    `[SCIM] Could not remove team membership for user_${hashEmail(email)}`,
                  );
                }),
            ]);
          }
        } else if (isActive) {
          // Reactivated — re-add to team
          const user = await prisma.user.upsert({
            where: { email },
            create: {
              email,
              name: [data.first_name, data.last_name]
                .filter(Boolean)
                .join(" "),
            },
            update: {
              name:
                [data.first_name, data.last_name].filter(Boolean).join(" ") ||
                undefined,
            },
          });

          await prisma.userTeam.upsert({
            where: {
              userId_teamId: {
                userId: user.id,
                teamId: tenant,
              },
            },
            update: {},
            create: {
              userId: user.id,
              teamId: tenant,
              role: "MEMBER",
            },
          });
        } else {
          // Just a name/attribute update
          await prisma.user
            .update({
              where: { email },
              data: {
                name:
                  [data.first_name, data.last_name]
                    .filter(Boolean)
                    .join(" ") || undefined,
              },
            })
            .catch(() => {
              console.warn(
                `[SCIM] Could not update user user_${hashEmail(email)} — user not found`,
              );
            });
        }
        break;
      }

      case "user.deleted": {
        console.log(
          `[SCIM] User deleted: user_${hashEmail(email)} for tenant ${tenant}`,
        );

        const deletedUser = await prisma.user.findUnique({
          where: { email },
        });

        if (deletedUser) {
          await Promise.all([
            prisma.link
              .updateMany({
                where: {
                  teamId: tenant,
                  ownerId: deletedUser.id,
                },
                data: {
                  ownerId: null,
                },
              })
              .catch(() => {
                console.warn(
                  `[SCIM] Could not reset link ownership for user_${hashEmail(email)}`,
                );
              }),
            prisma.userTeam
              .delete({
                where: {
                  userId_teamId: {
                    userId: deletedUser.id,
                    teamId: tenant,
                  },
                },
              })
              .catch(() => {
                console.warn(
                  `[SCIM] Could not remove team membership for user_${hashEmail(email)}`,
                );
              }),
          ]);
        }
        break;
      }

      case "group.created":
      case "group.updated":
      case "group.deleted":
      case "group.user_added":
      case "group.user_removed": {
        console.log(`[SCIM] Group event ${eventType} for tenant ${tenant}`);
        break;
      }
    }
  } catch (error) {
    console.error(`[SCIM] Error handling event ${eventType}:`, error);
  }
}
