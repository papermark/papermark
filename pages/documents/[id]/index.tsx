// Lazy load heavy components for better performance
import dynamic from "next/dynamic";
import ErrorPage from "next/error";

import { Suspense, useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";

import { useDocumentLinks } from "@/lib/swr/use-document";
import { useDocumentOverview } from "@/lib/swr/use-document-overview";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import DocumentHeader from "@/components/documents/document-header";
import { DocumentPreviewButton } from "@/components/documents/document-preview-button";
// Import placeholder components
import DocumentStatsPlaceholder from "@/components/documents/document-stats-placeholder";
import LinkDocumentIndicator from "@/components/documents/link-document-indicator";
import NotionAccessibilityIndicator from "@/components/documents/notion-accessibility-indicator";
import VideoStatsPlaceholder from "@/components/documents/video-stats-placeholder";
import AppLayout from "@/components/layouts/app";
import LinkSheet from "@/components/links/link-sheet";
import LinksTable from "@/components/links/links-table";
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

export default function DocumentPage() {
  const {
    data: overview,
    document: prismaDocument,
    primaryVersion,
    limits,
    team,
    isEmpty,
    loading: overviewLoading,
    error,
    mutate: mutateOverview,
  } = useDocumentOverview();

  // Always fetch links to show empty states properly
  const { links, error: linksError, mutate: mutateLinks } = useDocumentLinks();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const [isLinkSheetOpen, setIsLinkSheetOpen] = useState<boolean>(false);

  // Mutate function that updates both overview and links
  const mutateDocument = () => {
    mutateOverview();
    mutateLinks();
  };

  if (error && error.status === 400) {
    return <ErrorPage statusCode={400} />;
  }

  const AddLinkButton = () => {
    if (!limits?.canAddLinks) {
      return (
        <UpgradePlanModal
          clickedPlan={team?.isTrial ? PlanEnum.Business : PlanEnum.Pro}
          trigger={"limit_add_link"}
        >
          <Button className="flex h-8 whitespace-nowrap text-xs lg:h-9 lg:text-sm">
            Upgrade to Create Link
          </Button>
        </UpgradePlanModal>
      );
    } else {
      return (
        <Button
          className="flex h-8 whitespace-nowrap text-xs lg:h-9 lg:text-sm"
          onClick={() => setIsLinkSheetOpen(true)}
        >
          Create Link
        </Button>
      );
    }
  };

  // Show loading only for the initial overview load
  if (overviewLoading) {
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

  if (!prismaDocument || !primaryVersion || !teamId) {
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
          actions={[
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
              showTooltip={false}
              className="h-8 whitespace-nowrap text-xs lg:h-9 lg:text-sm"
            />,
            <AddLinkButton key={"create-link"} />,
          ]}
        />

        {/* Progressive Loading: Always show components, but optimize for empty states */}
        <Suspense
          fallback={
            <div className="h-48 animate-pulse rounded-lg bg-gray-100" />
          }
        >
          <>
            {/* Document Analytics - Always show, lazy loaded if not empty */}
            {primaryVersion.type !== "video" &&
              (isEmpty ? (
                <DocumentStatsPlaceholder
                  numPages={primaryVersion.numPages || 1}
                  onCreateLink={() => setIsLinkSheetOpen(true)}
                />
              ) : (
                <StatsComponent
                  documentId={prismaDocument.id}
                  numPages={primaryVersion.numPages!}
                />
              ))}

            {/* Video Analytics - Always show, lazy loaded if not empty */}
            {primaryVersion.type === "video" &&
              (isEmpty ? (
                <VideoStatsPlaceholder
                  length={primaryVersion.length || 51}
                  onCreateLink={() => setIsLinkSheetOpen(true)}
                />
              ) : (
                <VideoAnalytics
                  documentId={prismaDocument.id}
                  primaryVersion={primaryVersion}
                  teamId={teamId}
                />
              ))}

            {/* Links - Always show */}
            <LinksTable
              links={links}
              targetType={"DOCUMENT"}
              primaryVersion={primaryVersion}
              mutateDocument={mutateDocument}
            />

            {/* Visitors - Always show */}
            <VisitorsTable
              primaryVersion={primaryVersion}
              isVideo={primaryVersion.type === "video"}
            />
          </>
        </Suspense>

        <LinkSheet
          isOpen={isLinkSheetOpen}
          linkType="DOCUMENT_LINK"
          setIsOpen={setIsLinkSheetOpen}
          existingLinks={links}
        />
      </main>
    </AppLayout>
  );
}
