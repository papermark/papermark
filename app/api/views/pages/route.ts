import { NextRequest, NextResponse } from "next/server";

import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { verifyDataroomSession } from "@/lib/auth/dataroom-auth";
import { verifyPreviewSession } from "@/lib/auth/preview-auth";
import { getFile } from "@/lib/files/get-file";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";

const MAX_PAGES_PER_REQUEST = 15;
const VIEW_MAX_AGE_MS = 23 * 60 * 60 * 1000; // 23 hours

const viewRequestSchema = z.object({
  viewId: z.string().cuid(),
  documentVersionId: z.string().cuid(),
  pageNumbers: z
    .array(z.number().int().positive())
    .min(1)
    .max(MAX_PAGES_PER_REQUEST),
});

const previewRequestSchema = z.object({
  previewToken: z.string().min(1),
  linkId: z.string().min(1),
  documentVersionId: z.string().cuid(),
  pageNumbers: z
    .array(z.number().int().positive())
    .min(1)
    .max(MAX_PAGES_PER_REQUEST),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const viewParsed = viewRequestSchema.safeParse(body);
    const previewParsed = previewRequestSchema.safeParse(body);

    if (!viewParsed.success && !previewParsed.success) {
      return NextResponse.json(
        { message: "Invalid request." },
        { status: 400 },
      );
    }

    const { documentVersionId, pageNumbers } = viewParsed.success
      ? viewParsed.data
      : previewParsed.data!;

    if (previewParsed.success && !viewParsed.success) {
      const { previewToken, linkId } = previewParsed.data;

      const session = await getServerSession(authOptions);
      if (!session) {
        return NextResponse.json(
          { message: "Unauthorized." },
          { status: 401 },
        );
      }
      const userId = (session.user as CustomUser).id;

      const rateLimitResult = await ratelimit(60, "1 m").limit(
        `preview-pages:${linkId}`,
      );
      if (!rateLimitResult.success) {
        return NextResponse.json(
          { message: "Too many requests. Please try again later." },
          { status: 429 },
        );
      }

      const previewSession = await verifyPreviewSession(
        previewToken,
        userId,
        linkId,
      );
      if (!previewSession) {
        return NextResponse.json(
          { message: "Invalid or expired preview session." },
          { status: 401 },
        );
      }

      const [link, documentVersion] = await Promise.all([
        prisma.link.findUnique({
          where: { id: linkId },
          select: { documentId: true, dataroomId: true },
        }),
        prisma.documentVersion.findUnique({
          where: { id: documentVersionId },
          select: { documentId: true },
        }),
      ]);

      if (!link) {
        return NextResponse.json(
          { message: "Link not found." },
          { status: 404 },
        );
      }

      if (!documentVersion) {
        return NextResponse.json(
          { message: "Document version not found." },
          { status: 404 },
        );
      }

      if (link.documentId) {
        if (documentVersion.documentId !== link.documentId) {
          return NextResponse.json(
            { message: "Unauthorized access." },
            { status: 403 },
          );
        }
      } else if (link.dataroomId) {
        const dataroomDoc = await prisma.dataroomDocument.findFirst({
          where: {
            dataroomId: link.dataroomId,
            documentId: documentVersion.documentId,
          },
          select: { id: true },
        });
        if (!dataroomDoc) {
          return NextResponse.json(
            { message: "Unauthorized access." },
            { status: 403 },
          );
        }
      } else {
        return NextResponse.json(
          { message: "Unauthorized access." },
          { status: 403 },
        );
      }

      return await fetchAndReturnPages(documentVersionId, pageNumbers);
    }

    // Standard view-based auth path
    const { viewId } = viewParsed.data!;

    const [rateLimitResult, view, documentVersion] = await Promise.all([
      ratelimit(60, "1 m").limit(`view-pages:${viewId}`),
      prisma.view.findUnique({
        where: { id: viewId },
        select: {
          id: true,
          documentId: true,
          dataroomId: true,
          linkId: true,
          viewedAt: true,
        },
      }),
      prisma.documentVersion.findUnique({
        where: { id: documentVersionId },
        select: { documentId: true },
      }),
    ]);

    if (!rateLimitResult.success) {
      return NextResponse.json(
        { message: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    if (!view) {
      return NextResponse.json(
        { message: "View not found." },
        { status: 404 },
      );
    }

    if (Date.now() - view.viewedAt.getTime() > VIEW_MAX_AGE_MS) {
      return NextResponse.json(
        { message: "View session expired." },
        { status: 401 },
      );
    }

    if (!documentVersion || documentVersion.documentId !== view.documentId) {
      return NextResponse.json(
        { message: "Unauthorized access." },
        { status: 403 },
      );
    }

    if (view.dataroomId && view.linkId) {
      const session = await verifyDataroomSession(
        request,
        view.linkId,
        view.dataroomId,
      );
      if (!session) {
        return NextResponse.json(
          { message: "Invalid or expired session." },
          { status: 401 },
        );
      }
    }

    return await fetchAndReturnPages(documentVersionId, pageNumbers);
  } catch (error) {
    log({
      message: `Failed to fetch page URLs. \n\n ${error}`,
      type: "error",
    });
    return NextResponse.json(
      { message: (error as Error).message },
      { status: 500 },
    );
  }
}

async function fetchAndReturnPages(
  documentVersionId: string,
  pageNumbers: number[],
) {
  const documentPages = await prisma.documentPage.findMany({
    where: {
      versionId: documentVersionId,
      pageNumber: { in: pageNumbers },
    },
    select: {
      file: true,
      storageType: true,
      pageNumber: true,
    },
  });

  const pagesWithUrls = await Promise.all(
    documentPages.map(async (page) => {
      const { storageType, ...otherPage } = page;
      return {
        pageNumber: otherPage.pageNumber,
        file: await getFile({ data: page.file, type: storageType }),
      };
    }),
  );

  return NextResponse.json({ pages: pagesWithUrls });
}
