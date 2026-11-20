// Lazy load heavy components for better performance
import dynamic from "next/dynamic";
import ErrorPage from "next/error";
import Link from "next/link";

import { Suspense } from "react";

import { useTeam } from "@/context/team-context";
import { ExternalLinkIcon } from "lucide-react";

import { useSelfMembership } from "@/lib/hooks/use-self-membership";
import { useDataroomDocumentOverview } from "@/lib/swr/use-dataroom-document";
import { useDocumentLinks } from "@/lib/swr/use-document";

import DocumentHeader from "@/components/documents/document-header";
import { DocumentPreviewButton } from "@/components/documents/document-preview-button";
import LinkDocumentIndicator from "@/components/documents/link-document-indicator";
import NotionAccessibilityIndicator from "@/components/documents/notion-accessibility-indicator";
import AppLayout from "@/components/layouts/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import LoadingSpinner from "@/components/ui/loading-spinner";

const StatsComponent = dynamic(
  () =>
    import("@/components/documents/stats").then((mod) => ({
      default: mod.StatsComponent,
    })),
  {
    loading: () => (
      <div className="flex h-48 animate-pulse items-center justify-center rounded-lg bg-gray-100">
        <LoadingSpinner className="h-6 w-6" />
      </div>
    ),
    ssr: false,
  },
);

const VideoAnalytics = dynamic(
  () => import("@/components/documents/video-analytics"),
  {
    loading: () => (
      <div className="flex h-48 animate-pulse items-center justify-center rounded-lg bg-gray-100">
        <LoadingSpinner className="h-6 w-6" />
      </div>
    ),
    ssr: false,
  },
);

const VisitorsTable = dynamic(
  () => import("@/components/visitors/visitors-table"),
  {
    loading: () => (
      <div className="flex h-64 animate-pulse items-center justify-center rounded-lg bg-gray-100">
        <LoadingSpinner className="h-6 w-6" />
      </div>
    ),
    ssr: false,
  },
);

export default function DataroomDocumentPage() {
  const {
    documentId,
    dataroomDocumentId,
    document: prismaDocument,
    primaryVersion,
    dataroom,
    counts,
    loading: overviewLoading,
    error,
    mutate: mutateOverview,
  } = useDataroomDocumentOverview();

  // Reuse the existing (scope-guarded) document endpoints by threading the
  // resolved underlying document id, since router.query.id is the dataroom id.
  const { mutate: mutateLinks } = useDocumentLinks(documentId);
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const dataroomId = dataroom?.id;

  // Dataroom-scoped members only ever see the room's own visits. Full team
  // members additionally get a small count of the document's direct-link
  // visits, with a shortcut to the team-wide document page for the details.
  const { isDataroomMember } = useSelfMembership();
  const otherViewCount = counts?.otherViewCount ?? 0;

  const mutateDocument = () => {
    mutateOverview();
    mutateLinks();
  };

  if (error && error.status === 400) {
    return <ErrorPage statusCode={400} />;
  }

  if (overviewLoading || !prismaDocument || !primaryVersion || !teamId) {
    return (
      <AppLayout>
        <main className="relative mx-2 mb-10 mt-4 space-y-8 px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
          <div className="flex h-screen items-center justify-center">
            <LoadingSpinner className="mr-1 h-20 w-20" />
          </div>
        </main>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        {/* Action Header - Shows immediately */}
        <DocumentHeader
          primaryVersion={primaryVersion}
          prismaDocument={prismaDocument}
          teamId={teamId}
          dataroomId={dataroomId}
          dataroomDocumentId={dataroomDocumentId}
          actions={[
            // Jump to the team-wide document page. Hidden from data room
            // members (who have no access to the team-wide document surface).
            ...(!isDataroomMember
              ? [
                  <Button
                    key={"open-in-documents"}
                    asChild
                    variant="outline"
                    size="default"
                    className="h-8 whitespace-nowrap text-xs lg:h-9 lg:text-sm"
                  >
                    <Link
                      href={`/documents/${prismaDocument.id}`}
                      target="_blank"
                    >
                      <ExternalLinkIcon className="size-4" />
                      Open in All Documents
                    </Link>
                  </Button>,
                ]
              : []),
            <NotionAccessibilityIndicator
              key={"notion-status"}
              documentId={prismaDocument.id}
              primaryVersion={primaryVersion}
              onUrlUpdate={mutateDocument}
            />,
            <LinkDocumentIndicator
              key={"link-status"}
              documentId={prismaDocument.id}
              primaryVersion={primaryVersion}
              onUrlUpdate={mutateDocument}
            />,
            <DocumentPreviewButton
              key={"preview"}
              documentId={prismaDocument.id}
              primaryVersion={primaryVersion}
              advancedExcelEnabled={prismaDocument.advancedExcelEnabled}
              variant="outline"
              size="default"
              showTooltip
              className="h-8 whitespace-nowrap text-xs lg:h-9 lg:text-sm"
            />,
          ]}
        />

        <Suspense
          fallback={
            <div className="h-48 animate-pulse rounded-lg bg-gray-100" />
          }
        >
          <>
            {/* Document Analytics — scoped to this data room's visits */}
            {primaryVersion.type !== "video" && (
              <StatsComponent
                documentId={prismaDocument.id}
                numPages={primaryVersion.numPages ?? 1}
                dataroomId={dataroomId}
              />
            )}

            {/* Video Analytics */}
            {primaryVersion.type === "video" && (
              <VideoAnalytics
                documentId={prismaDocument.id}
                primaryVersion={primaryVersion}
                teamId={teamId}
              />
            )}

            {/* Data room visitors — the primary list for this page */}
            <VisitorsTable
              primaryVersion={primaryVersion}
              isVideo={primaryVersion.type === "video"}
              documentId={prismaDocument.id}
              dataroomId={dataroomId}
              viewScope="dataroom"
              title="Data room visitors"
              emptyMessage="No data room visits yet. Try sharing this data room."
            />

            {/* A small count of direct document-link visits. Shown to full team
                members only; the "Open in documents" button above is the path
                to the full breakdown. Hidden from data room-scoped members. */}
            {!isDataroomMember && otherViewCount > 0 ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <Badge variant="outline" className="text-muted-foreground">
                  {otherViewCount}
                </Badge>
                <span>
                  other {otherViewCount === 1 ? "visit" : "visits"} came from
                  the document&apos;s direct link.{" "}
                  <Link
                    href={`/documents/${prismaDocument.id}`}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                    target="_blank"
                  >
                    Open in All Documents
                  </Link>{" "}
                  to view {otherViewCount === 1 ? "it" : "them"}.
                </span>
              </div>
            ) : null}
          </>
        </Suspense>
      </main>
    </AppLayout>
  );
}
