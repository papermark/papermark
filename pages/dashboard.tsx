import { useRouter } from "next/router";

import { useEffect, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import { addDays, format } from "date-fns";
import { BarChart3 } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";

import { usePlan } from "@/lib/swr/use-billing";
import { fetcher } from "@/lib/utils";

import { AnalyticsCard } from "@/components/analytics/analytics-card";
import DashboardViewsChart from "@/components/analytics/dashboard-views-chart";
import DocumentsTable from "@/components/analytics/documents-table";
import LinksTable from "@/components/analytics/links-table";
import {
  TimeRange,
  TimeRangeSelect,
} from "@/components/analytics/time-range-select";
import ViewsTable from "@/components/analytics/views-table";
import VisitorsTable from "@/components/analytics/visitors-table";
import AppLayout from "@/components/layouts/app";
import { TabMenu } from "@/components/tab-menu";

interface OverviewData {
  counts: {
    links: number;
    documents: number;
    visitors: number;
    views: number;
  };
  graph: {
    date: string;
    views: number;
  }[];
  effectiveInterval?: TimeRange;
}
export const defaultRange = {
  start: addDays(new Date(), -7),
  end: addDays(new Date(), 0),
};

export default function DashboardPage() {
  const router = useRouter();
  const teamInfo = useTeam();
  const { plan, trial } = usePlan();
  const slug = useRef<boolean>(false);
  const [customRange, setCustomRange] = useState<{
    start: Date;
    end: Date;
  }>(defaultRange);

  // Check if user has access to data beyond 30 days
  const isPremium = plan !== "free" || !!trial;

  const {
    interval = "7d",
    type = "links",
    start,
    end,
  } = router.query as {
    interval: TimeRange;
    type: string;
    start: string;
    end: string;
  };

  const {
    data: overview,
    isLoading,
    error,
  } = useSWR<OverviewData>(
    teamInfo?.currentTeam?.id
      ? `/api/analytics?type=overview&interval=${interval}&teamId=${teamInfo.currentTeam.id}${interval === "custom" ? `&startDate=${format(customRange.start, "MM-dd-yyyy")}&endDate=${format(customRange.end, "MM-dd-yyyy")}` : ""}`
      : null,
    fetcher,
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
    },
  );

  // Sync URL when the server auto-expanded the interval (e.g. 7d had no data → 30d)
  useEffect(() => {
    if (overview?.effectiveInterval && overview.effectiveInterval !== interval) {
      const params = new URLSearchParams(window.location.search);
      params.set("interval", overview.effectiveInterval);
      if (type) params.set("type", type);
      router.replace(`/dashboard?${params.toString()}`, undefined, {
        shallow: true,
      });
    }
  }, [overview?.effectiveInterval]);

  if (error && !slug.current) {
    const errorObj = JSON.parse(error.message);
    const errorMessage = errorObj?.error;
    toast.info(errorMessage);
    setCustomRange(defaultRange);
    slug.current = true;
  }

  // Update the URL when time range changes
  const handleTimeRangeChange = (newTimeRange: TimeRange) => {
    const params = new URLSearchParams(window.location.search);
    params.set("interval", newTimeRange);
    if (type) {
      params.set("type", type);
    }
    // Only remove date params when switching to preset ranges
    if (newTimeRange !== "custom") {
      params.delete("start");
      params.delete("end");
    }
    router.push(`/dashboard?${params.toString()}`, undefined, {
      shallow: true,
    });
  };

  // Handle custom range URL updates
  const handleCustomRangeComplete = (range: { start: Date; end: Date }) => {
    const params = new URLSearchParams(window.location.search);
    params.set("interval", "custom");
    params.set("start", range.start.toISOString());
    params.set("end", range.end.toISOString());
    if (type) {
      params.set("type", type);
    }
    router.push(`/dashboard?${params.toString()}`, undefined, {
      shallow: true,
    });
  };

  return (
    <AppLayout>
      <div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
        <div className="flex items-center justify-between">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <TimeRangeSelect
            value={interval}
            onChange={handleTimeRangeChange}
            customRange={customRange}
            setCustomRange={setCustomRange}
            onCustomRangeComplete={handleCustomRangeComplete}
            slug={slug}
            isPremium={isPremium}
          />
        </div>

        <div className="space-y-4">
          <AnalyticsCard
            title="Views Overview"
            icon={<BarChart3 className="h-4 w-4" />}
            contentClassName="space-y-4"
          >
            <DashboardViewsChart
              timeRange={interval}
              data={overview?.graph}
              startDate={customRange.start}
              endDate={customRange.end}
            />
          </AnalyticsCard>

          <TabMenu
            navigation={[
              {
                label: "Links",
                href: `/dashboard?interval=${interval}&type=links`,
                value: "links",
                currentValue: type,
                count: overview?.counts.links,
              },
              {
                label: "Documents",
                href: `/dashboard?interval=${interval}&type=documents`,
                value: "documents",
                currentValue: type,
                count: overview?.counts.documents,
              },
              {
                label: "Visitors",
                href: `/dashboard?interval=${interval}&type=visitors`,
                value: "visitors",
                currentValue: type,
                count: overview?.counts.visitors,
              },
              {
                label: "Recent Views",
                href: `/dashboard?interval=${interval}&type=views`,
                value: "views",
                currentValue: type,
                count: overview?.counts.views,
              },
            ]}
            className="z-10"
          />

          <div className="grid grid-cols-1">
            {type === "links" && (
              <LinksTable
                startDate={customRange.start}
                endDate={customRange.end}
              />
            )}
            {type === "documents" && (
              <DocumentsTable
                startDate={customRange.start}
                endDate={customRange.end}
              />
            )}
            {type === "visitors" && (
              <VisitorsTable
                startDate={customRange.start}
                endDate={customRange.end}
              />
            )}
            {type === "views" && (
              <ViewsTable
                startDate={customRange.start}
                endDate={customRange.end}
              />
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
