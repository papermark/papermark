import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

export type VisitorStatus =
  | "BLOCKED"
  | "VISITED"
  | "INVITED"
  | "ALLOWED"
  | "ASSIGNED"
  | "NONE";

export type VisitorAccessSource = {
  type:
    | "ALLOW_LIST"
    | "VISITOR_GROUP"
    | "GROUP"
    | "DENY_LIST"
    | "ASSIGNMENT"
    | "BLOCK_LIST"
    | "INVITATION";
  name: string;
  /** Link id for link-backed sources, group id for group sources. */
  id?: string | null;
  /** Set when the source belongs to a data room, so the UI can open it. */
  dataroomId?: string | null;
};

export type VisitorAgreement = {
  name: string;
  signed: boolean;
  signedAt: Date | null;
};

export type VisitorRecord = {
  id: string | null;
  email: string;
  viewerName: string | null;
  verified: boolean;
  internal: boolean;
  agreement: VisitorAgreement | null;
  isDomain: boolean;
  status: VisitorStatus;
  totalVisits: number;
  documentViews: number;
  downloads: number;
  lastViewed: Date | null;
  invitedAt: Date | null;
  invitationStatus: string | null;
  accessSources: VisitorAccessSource[];
  createdAt: Date | null;
  updatedAt: Date | null;
};

type RawVisitorRow = {
  id: string | null;
  email: string;
  viewerName: string | null;
  verified: boolean | null;
  verifiedViews: number | null;
  status: VisitorStatus;
  totalVisits: number | null;
  documentViews: number | null;
  downloads: number | null;
  lastViewed: Date | null;
  invitedAt: Date | null;
  invitationStatus: string | null;
  accessSources: VisitorAccessSource[] | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  totalCount: number;
};

const VALID_SORT_FIELDS = ["lastViewed", "totalVisits", "downloads"];
const VALID_SORT_ORDERS = ["asc", "desc"];
const VALID_STATUSES: VisitorStatus[] = [
  "BLOCKED",
  "VISITED",
  "INVITED",
  "ALLOWED",
  "ASSIGNED",
  "NONE",
];

/**
 * Emails assigned work inside the scope: request-list tasks and Q&A questions.
 * Both live behind optional feature sets, so a missing table (an install that
 * has not run those migrations) yields an empty list instead of an error.
 */
async function getAssignmentEntries({
  teamId,
  dataroomId,
}: {
  teamId: string;
  dataroomId?: string;
}): Promise<{ email: string; source: string }[]> {
  const collect = async (sql: Prisma.Sql, source: string) => {
    try {
      const rows = (await prisma.$queryRaw(sql)) as { email: string | null }[];
      return rows
        .map((row) => row.email?.trim().toLowerCase())
        .filter((email): email is string => !!email)
        .map((email) => ({ email, source }));
    } catch (error) {
      return [];
    }
  };

  const [tasks, questions] = await Promise.all([
    collect(
      Prisma.sql`
        SELECT LOWER(COALESCE(av.email, ta.email)) AS email
        FROM "TaskAssignment" ta
        JOIN "Task" tk ON tk.id = ta."taskId"
        LEFT JOIN "Viewer" av ON av.id = ta."viewerId"
        WHERE ${
          dataroomId
            ? Prisma.sql`tk."dataroomId" = ${dataroomId}`
            : Prisma.sql`tk."teamId" = ${teamId}`
        }
          AND COALESCE(av.email, ta.email) IS NOT NULL`,
      "Request list",
    ),
    collect(
      Prisma.sql`
        SELECT LOWER(COALESCE(qv.email, qa.email)) AS email
        FROM "DataroomQuestionAssignment" qa
        JOIN "DataroomQuestion" q ON q.id = qa."questionId"
        LEFT JOIN "Viewer" qv ON qv.id = qa."viewerId"
        WHERE ${
          dataroomId
            ? Prisma.sql`q."dataroomId" = ${dataroomId}`
            : Prisma.sql`EXISTS (SELECT 1 FROM "Dataroom" d WHERE d.id = q."dataroomId" AND d."teamId" = ${teamId})`
        }
          AND COALESCE(qv.email, qa.email) IS NOT NULL`,
      "Q&A",
    ),
  ]);

  // De-duplicate so one person assigned many tasks contributes a single entry.
  const seen = new Set<string>();
  return [...tasks, ...questions].filter((entry) => {
    const key = `${entry.email}::${entry.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Returns the people who can reach a team (or a single dataroom), not just the
 * ones who already showed up: viewers with views, viewers who were invited by
 * email, and the emails/domains sitting on a link allow list — either directly,
 * through a visitor group applied to a link, or through a dataroom group.
 */
export async function getVisitors({
  teamId,
  dataroomId,
  page = 1,
  pageSize = 10,
  sortBy = "lastViewed",
  sortOrder = "desc",
  query,
  email,
  status,
  pauseStartsAt,
}: {
  teamId: string;
  dataroomId?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: string;
  query?: string;
  /** Exact-match lookup for a single person, far cheaper than `query`. */
  email?: string;
  status?: string;
  pauseStartsAt?: Date | null;
}) {
  const currentPage = Math.max(page, 1);
  const limit = Math.min(Math.max(pageSize, 1), 100);
  const offset = (currentPage - 1) * limit;

  const sort = VALID_SORT_FIELDS.includes(sortBy) ? sortBy : "lastViewed";
  const order = VALID_SORT_ORDERS.includes(sortOrder) ? sortOrder : "desc";

  const statusFilterValue = status?.toUpperCase();
  const statusFilter = VALID_STATUSES.includes(statusFilterValue as VisitorStatus)
    ? Prisma.sql`WHERE t.status = ${statusFilterValue}`
    : Prisma.empty;

  // Links that grant access within the requested scope.
  // teamId is indexed on Link while dataroomId is not, so lead with it — this
  // matches how the dataroom links endpoint already filters.
  const linkScope = dataroomId
    ? Prisma.sql`l."teamId" = ${teamId} AND l."dataroomId" = ${dataroomId}`
    : Prisma.sql`(
        l."teamId" = ${teamId}
        OR EXISTS (SELECT 1 FROM "Dataroom" d WHERE d.id = l."dataroomId" AND d."teamId" = ${teamId})
        OR EXISTS (SELECT 1 FROM "Document" doc WHERE doc.id = l."documentId" AND doc."teamId" = ${teamId})
      )`;

  const viewerGroupScope = dataroomId
    ? Prisma.sql`g."dataroomId" = ${dataroomId}`
    : Prisma.sql`g."teamId" = ${teamId}`;

  // Assignment tables belong to optional feature sets and may be absent on
  // installations that have not run every migration, so they are looked up
  // separately and skipped when unavailable rather than breaking the list.
  const assignmentEntries = await getAssignmentEntries({ teamId, dataroomId });
  const assignmentEntriesSelect = assignmentEntries.length
    ? Prisma.sql`
        SELECT a.email_key, 'ASSIGNMENT' AS source_type, a.source_name,
          NULL::text AS source_id, NULL::text AS source_dataroom_id
        FROM UNNEST(
          ARRAY[${Prisma.join(assignmentEntries.map((entry) => entry.email))}]::text[],
          ARRAY[${Prisma.join(assignmentEntries.map((entry) => entry.source))}]::text[]
        ) AS a(email_key, source_name)`
    : Prisma.sql`
        SELECT NULL::text AS email_key, NULL::text AS source_type, NULL::text AS source_name,
          NULL::text AS source_id, NULL::text AS source_dataroom_id
        WHERE FALSE`;

  // Views the stats are built from. Dataroom scope counts room sessions and
  // in-room document views; team scope keeps the historical document-view
  // definition of "total views" so existing numbers do not shift.
  const viewScope = dataroomId
    ? Prisma.sql`
        FROM "View" vw
        WHERE vw."dataroomId" = ${dataroomId}
          AND vw."viewerId" IS NOT NULL
          AND vw."isArchived" = false
          ${pauseStartsAt ? Prisma.sql`AND vw."viewedAt" < ${pauseStartsAt}` : Prisma.empty}`
    : Prisma.sql`
        FROM "View" vw
        JOIN "Viewer" vr ON vr.id = vw."viewerId" AND vr."teamId" = ${teamId}
        WHERE vw."viewerId" IS NOT NULL`;

  const visitsFilter = dataroomId
    ? Prisma.sql`vw."viewType" = 'DATAROOM_VIEW'`
    : Prisma.sql`vw."documentId" IS NOT NULL`;

  const lastViewedExpression = dataroomId
    ? Prisma.sql`MAX(vw."viewedAt")`
    : Prisma.sql`MAX(vw."viewedAt") FILTER (WHERE vw."documentId" IS NOT NULL)`;

  // Team scope lists every viewer of the team (historical behaviour); dataroom
  // scope only lists viewers with activity in that room.
  const basePeople = dataroomId
    ? Prisma.sql`
        SELECT DISTINCT LOWER(v.email) AS email_key
        FROM "Viewer" v
        JOIN view_stats vs ON vs."viewerId" = v.id
        WHERE v."teamId" = ${teamId} AND vs."allViews" > 0`
    : Prisma.sql`
        SELECT DISTINCT LOWER(v.email) AS email_key
        FROM "Viewer" v
        WHERE v."teamId" = ${teamId}`;

  // A viewer-level invite flag only makes sense when not scoped to one room.
  const invitedFallback = dataroomId
    ? Prisma.empty
    : Prisma.sql`OR v."invitedAt" IS NOT NULL`;

  const searchCondition = email
    ? Prisma.sql`AND p.email_key = ${email.trim().toLowerCase()}`
    : query
      ? Prisma.sql`AND (
        p.email_key LIKE LOWER(${`%${query}%`})
        OR LOWER(ln."viewerName") LIKE LOWER(${`%${query}%`})
      )`
      : Prisma.empty;

  let orderByClause: Prisma.Sql;
  if (sort === "totalVisits") {
    orderByClause =
      order === "desc"
        ? Prisma.sql`t."totalVisits" DESC, t."lastViewed" DESC NULLS LAST`
        : Prisma.sql`t."totalVisits" ASC, t."lastViewed" DESC NULLS LAST`;
  } else if (sort === "downloads") {
    orderByClause =
      order === "desc"
        ? Prisma.sql`t."downloads" DESC, t."lastViewed" DESC NULLS LAST`
        : Prisma.sql`t."downloads" ASC, t."lastViewed" DESC NULLS LAST`;
  } else {
    orderByClause =
      order === "desc"
        ? Prisma.sql`t."lastViewed" DESC NULLS LAST, t."createdAt" DESC NULLS LAST, t.email ASC`
        : Prisma.sql`t."lastViewed" ASC NULLS LAST, t."createdAt" DESC NULLS LAST, t.email ASC`;
  }

  const rows = (await prisma.$queryRaw`
    WITH scoped_links AS (
      SELECT l.id, l.name, l."allowList", l."denyList", l."groupId", l."dataroomId"
      FROM "Link" l
      WHERE ${linkScope}
        AND l."isArchived" = false
        AND l."deletedAt" IS NULL
    ),
    allow_list_entries AS (
      SELECT
        LOWER(TRIM(entry)) AS email_key,
        'ALLOW_LIST' AS source_type,
        COALESCE(NULLIF(sl.name, ''), 'Link #' || RIGHT(sl.id, 5)) AS source_name,
        sl.id AS source_id,
        sl."dataroomId" AS source_dataroom_id
      FROM scoped_links sl, UNNEST(sl."allowList") AS entry
      WHERE TRIM(entry) <> ''
    ),
    visitor_group_entries AS (
      SELECT
        LOWER(TRIM(entry)) AS email_key,
        'VISITOR_GROUP' AS source_type,
        vg.name AS source_name,
        vg.id AS source_id,
        sl."dataroomId" AS source_dataroom_id
      FROM "LinkVisitorGroup" lvg
      JOIN scoped_links sl ON sl.id = lvg."linkId"
      JOIN "VisitorGroup" vg ON vg.id = lvg."visitorGroupId",
      UNNEST(vg.emails) AS entry
      WHERE TRIM(entry) <> ''
    ),
    viewer_group_domain_entries AS (
      SELECT
        LOWER(TRIM(entry)) AS email_key,
        'GROUP' AS source_type,
        g.name AS source_name,
        g.id AS source_id,
        g."dataroomId" AS source_dataroom_id
      FROM "ViewerGroup" g, UNNEST(g.domains) AS entry
      WHERE ${viewerGroupScope}
        AND TRIM(entry) <> ''
    ),
    viewer_group_member_entries AS (
      SELECT
        LOWER(mv.email) AS email_key,
        'GROUP' AS source_type,
        g.name AS source_name,
        g.id AS source_id,
        g."dataroomId" AS source_dataroom_id
      FROM "ViewerGroupMembership" m
      JOIN "ViewerGroup" g ON g.id = m."groupId"
      JOIN "Viewer" mv ON mv.id = m."viewerId"
      WHERE ${viewerGroupScope}
    ),
    deny_list_entries AS (
      SELECT
        LOWER(TRIM(entry)) AS email_key,
        'DENY_LIST' AS source_type,
        COALESCE(NULLIF(sl.name, ''), 'Link #' || RIGHT(sl.id, 5)) AS source_name,
        sl.id AS source_id,
        sl."dataroomId" AS source_dataroom_id
      FROM scoped_links sl, UNNEST(sl."denyList") AS entry
      WHERE TRIM(entry) <> ''
    ),
    invitation_link_entries AS (
      SELECT
        LOWER(iv.email) AS email_key,
        'INVITATION' AS source_type,
        COALESCE(NULLIF(sl.name, ''), 'Link #' || RIGHT(sl.id, 5)) AS source_name,
        sl.id AS source_id,
        sl."dataroomId" AS source_dataroom_id
      FROM "ViewerInvitation" vi
      JOIN scoped_links sl ON sl.id = vi."linkId"
      JOIN "Viewer" iv ON iv.id = vi."viewerId"
    ),
    invitation_group_entries AS (
      SELECT
        LOWER(iv.email) AS email_key,
        'GROUP' AS source_type,
        g.name AS source_name,
        g.id AS source_id,
        g."dataroomId" AS source_dataroom_id
      FROM "ViewerInvitation" vi
      JOIN scoped_links sl ON sl.id = vi."linkId"
      JOIN "Viewer" iv ON iv.id = vi."viewerId"
      JOIN "ViewerGroup" g ON g.id = COALESCE(vi."groupId", sl."groupId")
    ),
    assignment_entries AS (
      ${assignmentEntriesSelect}
    ),
    access_entries AS (
      SELECT * FROM allow_list_entries
      UNION ALL SELECT * FROM visitor_group_entries
      UNION ALL SELECT * FROM viewer_group_domain_entries
      UNION ALL SELECT * FROM viewer_group_member_entries
      UNION ALL SELECT * FROM deny_list_entries
      UNION ALL SELECT * FROM invitation_link_entries
      UNION ALL SELECT * FROM invitation_group_entries
      UNION ALL SELECT * FROM assignment_entries
    ),
    access_agg AS (
      SELECT
        email_key,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
          'type', source_type,
          'name', source_name,
          'id', source_id,
          'dataroomId', source_dataroom_id
        )) AS sources,
        BOOL_OR(source_type IN ('ALLOW_LIST', 'VISITOR_GROUP', 'GROUP')) AS has_access,
        BOOL_OR(source_type = 'ASSIGNMENT') AS has_assignment,
        BOOL_OR(source_type = 'DENY_LIST') AS has_deny
      FROM access_entries
      GROUP BY email_key
    ),
    invite_agg AS (
      SELECT
        LOWER(iv.email) AS email_key,
        MAX(vi."sentAt") AS invited_at,
        (ARRAY_AGG(vi.status::text ORDER BY vi."sentAt" DESC))[1] AS invitation_status
      FROM "ViewerInvitation" vi
      JOIN scoped_links sl ON sl.id = vi."linkId"
      JOIN "Viewer" iv ON iv.id = vi."viewerId"
      GROUP BY LOWER(iv.email)
    ),
    view_stats AS (
      SELECT
        vw."viewerId",
        COUNT(*)::int AS "allViews",
        COUNT(*) FILTER (WHERE ${visitsFilter})::int AS "totalVisits",
        COUNT(DISTINCT vw."documentId")::int AS "documentViews",
        COUNT(*) FILTER (WHERE vw."downloadedAt" IS NOT NULL)::int AS "downloads",
        COUNT(*) FILTER (WHERE vw.verified)::int AS "verifiedViews",
        ${lastViewedExpression} AS "lastViewed"
      ${viewScope}
      GROUP BY vw."viewerId"
    ),
    latest_viewer_names AS (
      SELECT DISTINCT ON (vw."viewerId")
        vw."viewerId",
        vw."viewerName"
      ${viewScope}
        AND vw."viewerName" IS NOT NULL
      ORDER BY vw."viewerId", vw."viewedAt" DESC
    ),
    people AS (
      ${basePeople}
      UNION
      SELECT email_key FROM access_agg
      UNION
      SELECT email_key FROM invite_agg
    ),
    joined AS (
      SELECT
        v.id,
        COALESCE(v.email, p.email_key) AS email,
        ln."viewerName" AS "viewerName",
        COALESCE(v.verified, false) AS verified,
        CASE
          WHEN COALESCE(aa.has_deny, false) THEN 'BLOCKED'
          WHEN COALESCE(vs."allViews", 0) > 0 THEN 'VISITED'
          WHEN ia.email_key IS NOT NULL ${invitedFallback} THEN 'INVITED'
          WHEN COALESCE(aa.has_access, false) THEN 'ALLOWED'
          WHEN COALESCE(aa.has_assignment, false) THEN 'ASSIGNED'
          ELSE 'NONE'
        END AS status,
        COALESCE(vs."totalVisits", 0) AS "totalVisits",
        COALESCE(vs."documentViews", 0) AS "documentViews",
        COALESCE(vs."downloads", 0) AS "downloads",
        COALESCE(vs."verifiedViews", 0) AS "verifiedViews",
        vs."lastViewed" AS "lastViewed",
        COALESCE(ia.invited_at, v."invitedAt") AS "invitedAt",
        ia.invitation_status AS "invitationStatus",
        aa.sources AS "accessSources",
        v."createdAt" AS "createdAt",
        v."updatedAt" AS "updatedAt"
      FROM people p
      LEFT JOIN "Viewer" v ON LOWER(v.email) = p.email_key AND v."teamId" = ${teamId}
      LEFT JOIN view_stats vs ON vs."viewerId" = v.id
      LEFT JOIN latest_viewer_names ln ON ln."viewerId" = v.id
      LEFT JOIN access_agg aa ON aa.email_key = p.email_key
      LEFT JOIN invite_agg ia ON ia.email_key = p.email_key
      WHERE TRUE
        ${searchCondition}
    )
    SELECT t.*, (COUNT(*) OVER())::int AS "totalCount"
    FROM joined t
    ${statusFilter}
    ORDER BY ${orderByClause}
    LIMIT ${limit}
    OFFSET ${offset}
  `) as RawVisitorRow[];

  const viewerIds = rows
    .map((row) => row.id)
    .filter((id): id is string => !!id);

  // Agreements (NDAs) are answered per view, so the newest response in scope
  // stands for the person.
  const agreementResponses = viewerIds.length
    ? await prisma.agreementResponse.findMany({
        where: {
          view: {
            viewerId: { in: viewerIds },
            ...(dataroomId ? { dataroomId } : { teamId }),
          },
        },
        orderBy: { id: "desc" },
        select: {
          signingStatus: true,
          signedAt: true,
          completedAt: true,
          view: { select: { viewerId: true } },
          agreement: {
            select: {
              name: true,
              contentType: true,
              signingProvider: true,
            },
          },
        },
      })
    : [];

  const agreementByViewer = new Map<string, VisitorAgreement>();
  agreementResponses.forEach((response) => {
    const viewerId = response.view?.viewerId;
    if (!viewerId || agreementByViewer.has(viewerId)) return;

    // Signing agreements are only "signed" once the provider says so; plain
    // agreements count as accepted the moment the response exists.
    const isSigningAgreement =
      response.agreement.signingProvider === "DOCUMENSO" ||
      response.agreement.contentType === "SIGNING";
    const signed = isSigningAgreement
      ? response.signingStatus === "SIGNED" ||
        response.signingStatus === "COMPLETED"
      : true;

    agreementByViewer.set(viewerId, {
      name: response.agreement.name,
      signed,
      signedAt: response.signedAt ?? response.completedAt,
    });
  });

  // Teammates who opened the link show up as visitors too; flag them so the
  // table can mark them as internal.
  const teamUsers = await prisma.user.findMany({
    where: { teams: { some: { teamId } } },
    select: { email: true },
  });
  const teamEmails = new Set(
    teamUsers
      .map((user) => user.email?.toLowerCase())
      .filter((email): email is string => !!email),
  );

  // Views from links that do not ask for an email have no viewer to attach to,
  // so they are reported as one aggregate row instead of being dropped.
  const anonymousStats = await prisma.view.aggregate({
    where: dataroomId
      ? {
          dataroomId,
          viewerId: null,
          isArchived: false,
          ...(pauseStartsAt && { viewedAt: { lt: pauseStartsAt } }),
        }
      : { teamId, viewerId: null },
    _count: { _all: true },
    _max: { viewedAt: true },
  });

  const totalCount = rows[0]?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / limit);

  const visitors: VisitorRecord[] = rows.map((row) => ({
    id: row.id,
    email: row.email,
    viewerName: row.viewerName,
    // A viewer counts as verified once any of their views was email-verified.
    verified: (row.verified ?? false) || (row.verifiedViews ?? 0) > 0,
    internal: teamEmails.has(row.email.toLowerCase()),
    agreement: row.id ? (agreementByViewer.get(row.id) ?? null) : null,
    isDomain: row.email.startsWith("@"),
    status: row.status,
    totalVisits: row.totalVisits ?? 0,
    documentViews: row.documentViews ?? 0,
    downloads: row.downloads ?? 0,
    lastViewed: row.lastViewed,
    invitedAt: row.invitedAt,
    invitationStatus: row.invitationStatus,
    accessSources: (row.accessSources ?? []).map((source) => ({
      type: source.type as VisitorAccessSource["type"],
      name: source.name,
      id: source.id ?? null,
      dataroomId: source.dataroomId ?? null,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  return {
    visitors,
    anonymous: {
      visits: anonymousStats._count._all,
      lastViewed: anonymousStats._max.viewedAt,
    },
    pagination: {
      currentPage,
      pageSize: limit,
      totalItems: totalCount,
      totalPages,
      hasNext: currentPage < totalPages,
      hasPrev: currentPage > 1,
    },
    sorting: {
      sortBy: sort,
      sortOrder: order,
    },
  };
}
