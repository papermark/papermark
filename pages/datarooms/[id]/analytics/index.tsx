import { useState } from "react";

import { PlanEnum } from "@/ee/stripe/constants";
import { CircleHelpIcon } from "lucide-react";

import { usePlan } from "@/lib/swr/use-billing";
import { useDataroom } from "@/lib/swr/use-dataroom";

import DataroomAnalyticsOverview from "@/components/datarooms/analytics/analytics-overview";
import DocumentAnalyticsTree from "@/components/datarooms/analytics/document-analytics-tree";
import MockAnalyticsTable from "@/components/datarooms/analytics/mock-analytics-table";
import StatsCard from "@/components/datarooms/stats-card";
import AppLayout from "@/components/layouts/app";
import { TabMenu } from "@/components/tab-menu";
import { FeaturePreview } from "@/components/ui/feature-preview";
import { BadgeTooltip } from "@/components/ui/tooltip";

export default function DataroomAnalyticsPage() {
  const { dataroom } = useDataroom();
  const { isDatarooms, isDataroomsPlus, isTrial } = usePlan();

  const [selectedDocument, setSelectedDocument] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const hasAnalyticsAccess = isDatarooms || isDataroomsPlus || isTrial;

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Data Room Analytics
          </h1>
          <p className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
            Track document engagement and viewer behavior.
            <BadgeTooltip
              linkText="Learn more"
              content="Understand how viewers interact with your documents."
              key="analytics"
              link="https://www.papermark.com/help/article/viewer-analytics"
            >
              <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
            </BadgeTooltip>
          </p>
        </div>

        <TabMenu
          navigation={[
            {
              label: "Analytics",
              href: `/datarooms/${dataroom.id}/analytics`,
              value: "analytics",
              currentValue: "analytics",
            },
            {
              label: "Audit Log",
              href: `/datarooms/${dataroom.id}/analytics/audit-log`,
              value: "audit-log",
              currentValue: "analytics",
            },
          ]}
          className="md:hidden"
        />

        <StatsCard />

        {hasAnalyticsAccess ? (
          <div className="space-y-6">
            <DataroomAnalyticsOverview
              selectedDocument={selectedDocument}
              setSelectedDocument={setSelectedDocument}
            />
            <div>
              <h3 className="mb-4 text-lg font-medium">
                Dataroom Analytics{" "}
                {selectedDocument &&
                  `- Showing detailed metrics for "${selectedDocument.name}"`}
              </h3>
              <DocumentAnalyticsTree
                dataroomId={dataroom.id}
                selectedDocument={selectedDocument}
                setSelectedDocument={setSelectedDocument}
              />
            </div>
          </div>
        ) : (
          <FeaturePreview
            title="Advanced Dataroom Analytics"
            description="Get detailed insights into document engagement, completion rates, and visitor behavior patterns across your dataroom."
            requiredPlan={PlanEnum.DataRooms}
            trigger="dataroom_analytics_tab"
            upgradeButtonText="Data Rooms"
          >
            <MockAnalyticsTable />
          </FeaturePreview>
        )}
      </div>
    </AppLayout>
  );
}
