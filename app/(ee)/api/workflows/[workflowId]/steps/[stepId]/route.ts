import { NextRequest, NextResponse } from "next/server";

import {
  UpdateWorkflowStepRequestSchema,
  formatZodError,
  validateActions,
  validateConditions,
} from "@/ee/features/workflows/lib/validation";
import { authOptions } from "@/lib/auth/auth-options";
import { getServerSession } from "next-auth";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

// PATCH /app/(ee)/api/workflows/[workflowId]/steps/[stepId]?teamId=xxx - Update step
export async function PATCH(
  req: NextRequest,
  { params }: { params: { workflowId: string; stepId: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { workflowId, stepId } = params;
    const searchParams = req.nextUrl.searchParams;
    const teamId = searchParams.get("teamId");

    if (!teamId) {
      return NextResponse.json(
        { error: "teamId parameter is required" },
        { status: 400 },
      );
    }

    // Validate IDs format
    const idsValidation = z
      .object({
        workflowId: z.string().cuid(),
        stepId: z.string().cuid(),
        teamId: z.string().cuid(),
      })
      .safeParse({ workflowId, stepId, teamId });

    if (!idsValidation.success) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }

    const userId = (session.user as CustomUser).id;

    // Check user is part of the team using userTeam table
    const teamAccess = await prisma.userTeam.findUnique({
      where: {
        userId_teamId: {
          userId: userId,
          teamId: teamId,
        },
      },
    });

    if (!teamAccess) {
      return NextResponse.json(
        { error: "Unauthorized to access this team" },
        { status: 403 },
      );
    }

    const body = await req.json();

    // Validate request body
    const validation = UpdateWorkflowStepRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request data",
          details: formatZodError(validation.error),
        },
        { status: 400 },
      );
    }

    // Validate conditions if provided
    let validatedConditions: any | undefined;
    if (validation.data.conditions) {
      const conditionsValidation = validateConditions(
        validation.data.conditions,
      );
      if (!conditionsValidation.valid) {
        return NextResponse.json(
          { error: conditionsValidation.error },
          { status: 400 },
        );
      }
      validatedConditions = conditionsValidation.data;
    }

    // Validate actions if provided
    let validatedActions: any[] | undefined;
    if (validation.data.actions) {
      const actionsValidation = validateActions(validation.data.actions);
      if (!actionsValidation.valid) {
        return NextResponse.json(
          { error: actionsValidation.error },
          { status: 400 },
        );
      }

      // Use actionsValidation.data so enrichment persists
      validatedActions = actionsValidation.data;

      // Validate target link exists and belongs to the team
      const routeAction = validatedActions.find((a) => a.type === "route");
      if (routeAction && routeAction.targetLinkId) {
        // First get the workflow to get teamId
        const workflow = await prisma.workflow.findUnique({
          where: { id: workflowId },
          select: { teamId: true },
        });

        if (workflow) {
          const targetLink = await prisma.link.findUnique({
            where: {
              id: routeAction.targetLinkId,
              teamId: workflow.teamId,
            },
          });

          if (!targetLink) {
            return NextResponse.json(
              { error: "Target link not found or not accessible" },
              { status: 400 },
            );
          }

          // Update action with target details (mutates validatedActions)
          if (
            targetLink.linkType === "DOCUMENT_LINK" &&
            targetLink.documentId
          ) {
            routeAction.targetDocumentId = targetLink.documentId;
          } else if (
            targetLink.linkType === "DATAROOM_LINK" &&
            targetLink.dataroomId
          ) {
            routeAction.targetDataroomId = targetLink.dataroomId;
          }
        }
      }
    }

    // Check step exists and workflow belongs to team
    const step = await prisma.workflowStep.findUnique({
      where: {
        id: stepId,
        workflowId: workflowId,
      },
      select: {
        id: true,
        workflow: {
          select: {
            id: true,
            teamId: true,
          },
        },
      },
    });

    if (!step || step.workflow.teamId !== teamId) {
      return NextResponse.json({ error: "Step not found" }, { status: 404 });
    }

    // Extract emails and domains from conditions to sync with link allowList (if conditions updated)
    let allowListItems: string[] | undefined;
    if (validatedConditions) {
      allowListItems = [];
      if (validatedConditions.items) {
        validatedConditions.items.forEach((condition: any) => {
          const values = Array.isArray(condition.value)
            ? condition.value
            : [condition.value];
          if (condition.type === "domain") {
            // Add @ prefix for domains in allowList
            allowListItems!.push(...values.map((v: string) => `@${v}`));
          } else if (condition.type === "email") {
            allowListItems!.push(...values);
          }
        });
      }
    }

    // Get target link ID (either from update or existing step)
    let targetLinkId: string | undefined;
    if (validatedActions) {
      const routeAction = validatedActions.find((a) => a.type === "route");
      targetLinkId = routeAction?.targetLinkId;
    } else {
      // Get from existing step
      const existingStep = await prisma.workflowStep.findUnique({
        where: { id: stepId },
        select: { actions: true },
      });
      const existingActions = existingStep?.actions as any[];
      const existingRouteAction = existingActions?.find(
        (a) => a.type === "route",
      );
      targetLinkId = existingRouteAction?.targetLinkId;
    }

    // Build update data with validated conditions and actions (if provided)
    const updateData: any = { ...validation.data };
    if (validatedConditions) {
      updateData.conditions = validatedConditions;
    }
    if (validatedActions) {
      updateData.actions = validatedActions;
    }

    // Update step and optionally update link allowList in transaction
    const updates: any[] = [
      prisma.workflowStep.update({
        where: { id: stepId },
        data: updateData as any,
      }),
    ];

    // If we have allowList updates and a target link, sync the link
    if (allowListItems !== undefined && targetLinkId) {
      updates.push(
        prisma.link.update({
          where: { id: targetLinkId },
          data: { allowList: allowListItems },
        }),
      );
    }

    const [updatedStep] = await prisma.$transaction(updates);

    return NextResponse.json(updatedStep);
  } catch (error) {
    console.error("Error updating workflow step:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE /app/(ee)/api/workflows/[workflowId]/steps/[stepId]?teamId=xxx - Delete step
export async function DELETE(
  req: NextRequest,
  { params }: { params: { workflowId: string; stepId: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { workflowId, stepId } = params;
    const searchParams = req.nextUrl.searchParams;
    const teamId = searchParams.get("teamId");

    if (!teamId) {
      return NextResponse.json(
        { error: "teamId parameter is required" },
        { status: 400 },
      );
    }

    // Validate IDs format
    const idsValidation = z
      .object({
        workflowId: z.string().cuid(),
        stepId: z.string().cuid(),
        teamId: z.string().cuid(),
      })
      .safeParse({ workflowId, stepId, teamId });

    if (!idsValidation.success) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }

    const userId = (session.user as CustomUser).id;

    // Check user is part of the team using userTeam table
    const teamAccess = await prisma.userTeam.findUnique({
      where: {
        userId_teamId: {
          userId: userId,
          teamId: teamId,
        },
      },
    });

    if (!teamAccess) {
      return NextResponse.json(
        { error: "Unauthorized to access this team" },
        { status: 403 },
      );
    }

    // Check step exists and workflow belongs to team
    const step = await prisma.workflowStep.findUnique({
      where: {
        id: stepId,
        workflowId: workflowId,
      },
      select: {
        id: true,
        stepOrder: true,
        workflow: {
          select: {
            id: true,
            teamId: true,
          },
        },
      },
    });

    if (!step || step.workflow.teamId !== teamId) {
      return NextResponse.json({ error: "Step not found" }, { status: 404 });
    }

    // Get steps that need reordering (those after the deleted step)
    const stepsToReorder = await prisma.workflowStep.findMany({
      where: {
        workflowId,
        stepOrder: { gt: step.stepOrder },
      },
      select: {
        id: true,
        stepOrder: true,
      },
    });

    // Delete step and reorder remaining steps in a transaction
    await prisma.$transaction([
      prisma.workflowStep.delete({
        where: { id: stepId },
      }),
      ...stepsToReorder.map((s) =>
        prisma.workflowStep.update({
          where: { id: s.id },
          data: { stepOrder: s.stepOrder - 1 },
        }),
      ),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting workflow step:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
