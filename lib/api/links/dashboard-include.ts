import { LinkType } from "@prisma/client";

export function dashboardLinkInclude(linkType: LinkType) {
  const viewsWhere =
    linkType === LinkType.DATAROOM_LINK
      ? { viewType: "DATAROOM_VIEW" as const }
      : undefined;

  return {
    views: {
      ...(viewsWhere ? { where: viewsWhere } : {}),
      orderBy: { viewedAt: "desc" as const },
      take: 1,
    },
    customFields: true,
    visitorGroups: {
      select: { visitorGroupId: true },
    },
    _count: {
      select: {
        views: viewsWhere ? { where: viewsWhere } : true,
      },
    },
    tags: {
      select: {
        tag: {
          select: {
            id: true,
            name: true,
            description: true,
            color: true,
          },
        },
      },
    },
  };
}
