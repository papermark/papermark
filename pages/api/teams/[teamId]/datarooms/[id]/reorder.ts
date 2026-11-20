import type { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { enforceDataroomMemberScope } from "@/lib/api/rbac/guard";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

type OrderItem = {
  id: string;
  category: "folder" | "document";
  orderIndex: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const userId = (session.user as CustomUser).id;
  const { teamId, id: dataroomId } = req.query as {
    teamId: string;
    id: string;
  };
  const newOrder: OrderItem[] = req.body;

  if (
    !Array.isArray(newOrder) ||
    !teamId ||
    !dataroomId ||
    typeof teamId !== "string" ||
    typeof dataroomId !== "string"
  ) {
    return res.status(400).json({ message: "Invalid input" });
  }

  const isValidOrderItem = (item: unknown): item is OrderItem => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const { id, category, orderIndex } = item as OrderItem;

    return (
      typeof id === "string" &&
      id.length > 0 &&
      (category === "folder" || category === "document") &&
      Number.isInteger(orderIndex) &&
      Number.isFinite(orderIndex)
    );
  };

  if (!newOrder.every(isValidOrderItem)) {
    return res.status(400).json({ message: "Invalid input" });
  }

  const seenKeys = new Set<string>();
  for (const item of newOrder) {
    const key = `${item.category}:${item.id}`;
    if (seenKeys.has(key)) {
      return res.status(400).json({ message: "Duplicate reorder entries" });
    }
    seenKeys.add(key);
  }

  try {
    // Scoped members may only reorder within their assigned rooms.
    if (await enforceDataroomMemberScope({ userId, teamId, dataroomId, res })) {
      return;
    }

    const team = await prisma.team.findUnique({
      where: {
        id: teamId,
        users: { some: { userId } },
        datarooms: { some: { id: dataroomId } },
      },
      select: { id: true },
    });

    if (!team) {
      return res.status(403).end("Forbidden");
    }

    await prisma.$transaction(async (tx) => {
      for (const item of newOrder) {
        if (item.category === "folder") {
          const updatedFolder = await tx.dataroomFolder.updateMany({
            where: { id: item.id, dataroomId },
            data: { orderIndex: item.orderIndex },
          });

          if (updatedFolder.count === 0) {
            throw new Error("REORDER_ITEM_NOT_FOUND");
          }
        } else {
          const updatedDocument = await tx.dataroomDocument.updateMany({
            where: { id: item.id, dataroomId },
            data: { orderIndex: item.orderIndex },
          });

          if (updatedDocument.count === 0) {
            throw new Error("REORDER_ITEM_NOT_FOUND");
          }
        }
      }
    });

    res.status(200).json({ message: "Order updated successfully" });
  } catch (error) {
    if (error instanceof Error && error.message === "REORDER_ITEM_NOT_FOUND") {
      return res.status(404).json({ message: "Item not found" });
    }

    console.error("Error updating order:", error);
    res.status(500).json({ message: "Error updating order" });
  }
}
