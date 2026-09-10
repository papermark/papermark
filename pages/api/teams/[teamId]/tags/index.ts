import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser, tagColors } from "@/lib/types";

import {
  COLORS_LIST,
  randomBadgeColor,
} from "@/components/links/link-sheet/tags/tag-badge";

export const searchParamsSchema = z.object({
  sortBy: z
    .enum(["name", "createdAt"])
    .optional()
    .default("name")
    .describe("The field to sort the tags by."),
  sortOrder: z
    .enum(["asc", "desc"])
    .optional()
    .default("asc")
    .describe("The order to sort the tags by."),
  search: z
    .string()
    .optional()
    .describe("The search term to filter the tags by."),
  includeLinksCount: z
    .preprocess((val) => val === "true", z.boolean())
    .optional(),
  page: z
    .preprocess((val) => parseInt(val as string, 10), z.number().min(1))
    .optional(),
  pageSize: z
    .preprocess(
      (val) => parseInt(val as string, 10),
      z.number().min(1).max(100),
    )
    .optional(),
});

export const tagColorSchema = z
  .enum(tagColors, {
    errorMap: () => {
      return {
        message: `Invalid color. Must be one of: ${tagColors.join(", ")}`,
      };
    },
  })
  .describe("The color of the tag");

export const createTagBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3)
      .max(50)
      .describe("The name of the tag to create."),
    color: tagColorSchema.describe(
      `The color of the tag. If not provided, a random color will be used from the list: ${tagColors.join(", ")}.`,
    ),
    description: z
      .string()
      .trim()
      .max(120)
      .nullish()
      .describe("The description of the tag to create."),
  })
  .partial()
  .superRefine((data, ctx) => {
    if (!data.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: "Name is required.",
      });
    }
  });

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const { teamId } = req.query as { teamId: string };

  try {
    const team = await prisma.team.findUnique({
      where: {
        id: teamId,
      },
      select: {
        id: true,
        users: { select: { userId: true } },
      },
    });

    // check that the user is member of the team, otherwise return 403
    const teamUsers = team?.users;
    const isUserPartOfTeam = teamUsers?.some(
      (user) => user.userId === (session.user as CustomUser).id,
    );
    if (!isUserPartOfTeam) {
      return res.status(403).end("Unauthorized to access this team");
    }
  } catch (error) {
    errorhandler(error, res);
    return;
  }
  if (req.method === "GET") {
    // GET /api/teams/:teamId/tag
    const { search, includeLinksCount, sortBy, sortOrder, pageSize, page } =
      searchParamsSchema.parse(req.query);

    const whereCondition = {
      teamId: teamId,
      ...(search && {
        name: {
          contains: search,
        },
      }),
    };

    const [tags, totalCount] = await prisma.$transaction([
      prisma.tag.findMany({
        where: whereCondition,
        select: {
          id: true,
          name: true,
          color: true,
          description: true,
          ...(includeLinksCount && {
            _count: {
              select: {
                items: true,
              },
            },
          }),
        },
        orderBy: {
          [sortBy]: sortOrder,
        },
        ...(pageSize &&
          page && {
            take: pageSize,
            skip: (page - 1) * pageSize,
          }),
      }),
      prisma.tag.count({ where: whereCondition }),
    ]);

    if (!tags) {
      return res.status(200).json({ tags: null, totalCount: 0 });
    }

    return res.status(200).json({ tags, totalCount });
  } else if (req.method === "POST") {
    // POST /api/teams/:teamId/tag

    const { color, name, description } = createTagBodySchema.parse(req.body);

    const existingTag = await prisma.tag.findFirst({
      where: {
        teamId: teamId,
        name: name,
      },
    });
    if (existingTag) {
      return res.status(400).json({
        error: "A tag with that name already exists.",
      });
    }
    const response = await prisma.tag.create({
      data: {
        name: name!,
        color:
          color && COLORS_LIST.map(({ color }) => color).includes(color)
            ? color
            : randomBadgeColor(),
        teamId: teamId,
        description: description,
      },
    });
    return res.status(200).json(response);
  } else {
    // We only allow GET and DELETE requests
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
