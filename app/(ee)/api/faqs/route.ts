import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyDataroomSession } from "@/lib/auth/dataroom-auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Validation schema for query parameters
const visitorFAQParamsSchema = z.object({
  linkId: z.string().cuid("Invalid link ID format"),
  dataroomId: z.string().cuid("Invalid dataroom ID format"),
  documentId: z.string().cuid("Invalid document ID format").nullish(),
});

export interface VisitorFAQResponse {
  id: string;
  editedQuestion: string;
  answer: string;
  documentPageNumber?: number;
  documentVersionNumber?: number;
  createdAt: string;
  document?: {
    name: string;
  };
}

// GET /api/faqs?linkId=xxx&dataroomId=xxx - List published FAQs for visitors
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;

    // Validate query parameters
    const paramValidation = visitorFAQParamsSchema.safeParse({
      linkId: searchParams.get("linkId"),
      dataroomId: searchParams.get("dataroomId"),
      documentId: searchParams.get("documentId"),
    });

    if (!paramValidation.success) {
      return NextResponse.json(
        {
          error: "Invalid parameters",
          details: paramValidation.error.errors[0]?.message,
        },
        { status: 400 },
      );
    }

    const { linkId, dataroomId, documentId } = paramValidation.data;

    // Verify dataroom session
    const session = await verifyDataroomSession(req, linkId, dataroomId);
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized - invalid or expired session" },
        { status: 401 },
      );
    }

    // Build where clause based on visibility filters
    const whereClause: any = {
      dataroomId,
      status: "PUBLISHED",
    };

    // Apply visibility filters
    const visibilityFilters: any[] = [
      { visibilityMode: "PUBLIC_DATAROOM" },
    ];

    if (linkId) {
      visibilityFilters.push({
        visibilityMode: "PUBLIC_LINK",
        linkId: linkId,
      });
    }

    if (documentId) {
      visibilityFilters.push({
        visibilityMode: "PUBLIC_DOCUMENT",
        dataroomDocumentId: documentId,
      });
    }

    whereClause.OR = visibilityFilters;

    // Fetch published FAQs
    const faqs = await prisma.dataroomFaqItem.findMany({
      where: whereClause,
      select: {
        id: true,
        editedQuestion: true,
        answer: true,
        documentPageNumber: true,
        documentVersionNumber: true,
        createdAt: true,
        dataroomDocument: {
          select: {
            document: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Format response
    const response: VisitorFAQResponse[] = faqs.map((faq: any) => ({
      id: faq.id,
      editedQuestion: faq.editedQuestion,
      answer: faq.answer,
      documentPageNumber: faq.documentPageNumber || undefined,
      documentVersionNumber: faq.documentVersionNumber || undefined,
      createdAt: faq.createdAt.toISOString(),
      document: faq.dataroomDocument?.document
        ? {
            name: faq.dataroomDocument.document.name,
          }
        : undefined,
    }));

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching visitor FAQs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
