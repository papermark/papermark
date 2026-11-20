import { withTeamApi } from "@/lib/api/auth/with-session-team";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";

/**
 * Per-dataroom internal team membership (read + remove).
 *
 * GET    — list team members who can access this room (full members always do;
 *          DATAROOM_MEMBERs only when assigned via UserDataroom) + pending
 *          invitations scoped to this room.
 * DELETE — remove a scoped member's access to this room ({ userId }) or revoke a
 *          pending invitation ({ email }).
 *
 * Inviting/adding members reuses the team invite flow
 * (POST /api/teams/[teamId]/invite) with role=DATAROOM_MEMBER and the room
 * preselected, so seat limits and invitations stay consistent team-wide.
 *
 * Gated to the Data Rooms plan and higher; removal is ADMIN/MANAGER-only.
 */
export default withTeamApi(
  async ({ req, res, teamId, role }) => {
    const { id: dataroomId } = req.query as { id: string };

    // Ensure the room belongs to the team before doing anything else.
    const dataroom = await prisma.dataroom.findUnique({
      where: { id: dataroomId, teamId },
      select: { id: true, name: true },
    });
    if (!dataroom) {
      return res.status(404).json({ error: "Data room not found" });
    }

    if (req.method === "GET") {
      try {
        const [teamUsers, roomAssignments, invitations] = await Promise.all([
          prisma.userTeam.findMany({
            where: { teamId },
            select: {
              role: true,
              status: true,
              userId: true,
              user: { select: { name: true, email: true } },
            },
          }),
          prisma.userDataroom.findMany({
            where: { teamId, dataroomId },
            select: { userId: true },
          }),
          prisma.invitation.findMany({
            where: {
              teamId,
              role: "DATAROOM_MEMBER",
              dataroomIds: { has: dataroomId },
            },
            select: { email: true, expires: true },
          }),
        ]);

        const assignedUserIds = new Set(
          roomAssignments.map((row) => row.userId),
        );

        const members = teamUsers
          .filter((member) => {
            // Full team members have access to every room. Scoped members only
            // count when explicitly assigned to this one.
            if (member.role === "DATAROOM_MEMBER") {
              return assignedUserIds.has(member.userId);
            }
            return true;
          })
          .map((member) => ({
            userId: member.userId,
            name: member.user.name,
            email: member.user.email,
            role: member.role,
            status: member.status,
            scoped: member.role === "DATAROOM_MEMBER",
          }));

        return res.status(200).json({ members, invitations });
      } catch (error) {
        return errorhandler(error, res);
      }
    }

    if (req.method === "DELETE") {
      if (role !== "ADMIN" && role !== "MANAGER") {
        return res.status(403).json({
          error: "Only admins and managers can manage data room members.",
        });
      }

      const { userId: targetUserId, email } = req.body as {
        userId?: string;
        email?: string;
      };

      try {
        // Revoke a pending invitation scoped to this room.
        if (email) {
          await prisma.invitation.deleteMany({
            where: {
              teamId,
              email,
              role: "DATAROOM_MEMBER",
              dataroomIds: { has: dataroomId },
            },
          });
          return res.status(204).end();
        }

        if (!targetUserId) {
          return res
            .status(400)
            .json({ error: "Provide a userId or email to remove." });
        }

        const target = await prisma.userTeam.findUnique({
          where: { userId_teamId: { userId: targetUserId, teamId } },
          select: { role: true },
        });

        if (!target) {
          return res
            .status(400)
            .json({ error: "This user is not part of the team." });
        }

        if (target.role !== "DATAROOM_MEMBER") {
          return res.status(400).json({
            error:
              "Full team members have access to all data rooms. Change their role in Settings → People to restrict access.",
          });
        }

        await prisma.userDataroom.deleteMany({
          where: { userId: targetUserId, teamId, dataroomId },
        });

        return res.status(204).end();
      } catch (error) {
        return errorhandler(error, res);
      }
    }

    res.setHeader("Allow", ["GET", "DELETE"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  },
  {
    requiredPermissions: ["datarooms.read"],
    requiredPlan: (plan) =>
      plan.startsWith("datarooms") || plan.includes("drtrial"),
    dataroomParam: "id",
  },
);
