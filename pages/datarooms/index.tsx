import Link from "next/link";
import { useRouter } from "next/router";

import { useEffect, useMemo, useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { FilterIcon, PlusIcon } from "lucide-react";
import { useQueryState } from "nuqs";

import { usePlan } from "@/lib/swr/use-billing";
import useDatarooms from "@/lib/swr/use-datarooms";
import useLimits from "@/lib/swr/use-limits";
import { useTags } from "@/lib/swr/use-tags";
import { daysLeft } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { AddDataroomModal } from "@/components/datarooms/add-dataroom-modal";
import DataroomCard from "@/components/datarooms/dataroom-card";
import { DataroomTrialModal } from "@/components/datarooms/dataroom-trial-modal";
import { EmptyDataroom } from "@/components/datarooms/empty-dataroom";
import AppLayout from "@/components/layouts/app";
import { SearchBoxPersisted } from "@/components/search-box";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select-v2";
import { Separator } from "@/components/ui/separator";

export default function DataroomsPage() {
  const teamInfo = useTeam();
  const { datarooms, totalCount } = useDatarooms();
  const { isFree, isPro, isBusiness, isDatarooms, isDataroomsPlus, isTrial } =
    usePlan();
  const { limits } = useLimits();
  const router = useRouter();

  const [tagsFilter, setTagsFilter] = useQueryState<string[]>("tags", {
    parse: (value: string) => value.split(",").filter(Boolean),
    serialize: (value: string[]) => value.join(","),
  });
  const [isTagsPopoverOpen, setIsTagsPopoverOpen] = useState(false);

  const { tags: availableTags } = useTags({
    query: {
      sortBy: "name",
      sortOrder: "asc",
    },
  });

  const totalDatarooms = totalCount ?? 0;
  const limitDatarooms = limits?.datarooms ?? 1;

  const canCreateUnlimitedDatarooms =
    isDatarooms ||
    isDataroomsPlus ||
    (isBusiness && totalDatarooms < limitDatarooms);

  const searchQuery = router.query.search as string | undefined;

  // Sort datarooms alphabetically by name
  const sortedDatarooms = datarooms?.slice().sort((a, b) => {
    return a.name.localeCompare(b.name);
  });

  // Filter out only dataroom tags
  const dataroomTags = useMemo(() => {
    if (!availableTags) return [];
    return availableTags;
  }, [availableTags]);

  const tagOptions = useMemo(() => {
    return (
      dataroomTags?.map((tag) => ({
        value: tag.name,
        label: tag.name,
        meta: { color: tag.color, description: tag.description },
      })) || []
    );
  }, [dataroomTags]);

  const selectedTagValues = useMemo(() => {
    return tagsFilter || [];
  }, [tagsFilter]);

  const hasActiveFilters = searchQuery || tagsFilter?.length;

  useEffect(() => {
    if (!isTrial && (isFree || isPro)) router.push("/documents");
  }, [isTrial, isFree, isPro]);

  return (
    <AppLayout>
      <main className="p-4 sm:m-4 sm:px-4 sm:py-4">
        <section className="mb-4 flex items-center justify-between md:mb-8 lg:mb-12">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Datarooms
            </h2>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Manage your datarooms
            </p>
          </div>
          <div className="flex items-center gap-x-1">
            {isBusiness && !canCreateUnlimitedDatarooms ? (
              <UpgradePlanModal
                clickedPlan={PlanEnum.DataRooms}
                trigger="datarooms"
              >
                <Button
                  className="group flex flex-1 items-center justify-start gap-x-3 px-3 text-left"
                  title="Upgrade to Add Data Room"
                >
                  <span>Upgrade to Add Data Room</span>
                </Button>
              </UpgradePlanModal>
            ) : isTrial &&
              datarooms &&
              !isBusiness &&
              !isDatarooms &&
              !isDataroomsPlus ? (
              <div className="flex items-center gap-x-4">
                <div className="text-sm text-destructive">
                  <span>Dataroom Trial: </span>
                  <span className="font-medium">
                    {(() => {
                      const startDate =
                        datarooms && datarooms.length > 0
                          ? datarooms[datarooms.length - 1]?.createdAt
                          : new Date(
                              teamInfo?.currentTeam?.createdAt ?? Date.now(),
                            );
                      const days = daysLeft(new Date(startDate), 7);
                      if (days <= 0) return "Expired";
                      const label = days === 1 ? "day" : "days";
                      return `${days} ${label} left`;
                    })()}
                  </span>
                </div>
                {totalDatarooms < limitDatarooms ? (
                  <AddDataroomModal>
                    <Button
                      className="group flex flex-1 items-center justify-start gap-x-3 px-3 text-left"
                      title="Create New Dataroom"
                    >
                      <PlusIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
                      <span>Create New Dataroom</span>
                    </Button>
                  </AddDataroomModal>
                ) : (
                  <UpgradePlanModal
                    clickedPlan={PlanEnum.DataRooms}
                    trigger="datarooms"
                  >
                    <Button
                      className="group flex flex-1 items-center justify-start gap-x-3 px-3 text-left"
                      title="Upgrade to Add Data Room"
                    >
                      <span>Upgrade to Add Data Room</span>
                    </Button>
                  </UpgradePlanModal>
                )}
              </div>
            ) : isBusiness || isDatarooms || isDataroomsPlus ? (
              <AddDataroomModal>
                <Button
                  className="group flex flex-1 items-center justify-start gap-x-3 px-3 text-left"
                  title="Create New Document"
                >
                  <PlusIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>Create New Dataroom</span>
                </Button>
              </AddDataroomModal>
            ) : (
              <DataroomTrialModal>
                <Button
                  className="group flex flex-1 items-center justify-start gap-x-3 px-3 text-left"
                  title="Start Data Room Plus Trial"
                >
                  <span>Start Data Room Plus Trial</span>
                </Button>
              </DataroomTrialModal>
            )}
          </div>
        </section>
        {/* Search and Filters */}
        <div className="mb-4 flex justify-end gap-3">
          <div className="w-full sm:w-[280px]">
            <SearchBoxPersisted
              placeholder="Search datarooms..."
              inputClassName="h-10"
            />
          </div>

          <div className="w-full sm:w-[320px]">
            <MultiSelect
              options={tagOptions}
              value={selectedTagValues}
              onValueChange={(value) =>
                setTagsFilter(value.length > 0 ? value : null)
              }
              placeholder="Tags"
              maxCount={2}
              searchPlaceholder="Search tags..."
              isPopoverOpen={isTagsPopoverOpen}
              setIsPopoverOpen={setIsTagsPopoverOpen}
              popoverClassName="sm:w-[320px]"
            />
          </div>
        </div>

        {hasActiveFilters && (
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              Showing {sortedDatarooms?.length || 0} of {totalDatarooms}{" "}
              dataroom
              {totalDatarooms !== 1 ? "s" : ""}
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => {
                router.push(
                  {
                    pathname: router.pathname,
                    query: {},
                  },
                  undefined,
                  { shallow: true },
                );
              }}
            >
              Clear filters
            </Button>
          </div>
        )}

        <Separator className="mb-5 bg-gray-200 dark:bg-gray-800" />

        <div className="space-y-4">
          <ul className="grid grid-cols-1 gap-x-6 gap-y-8 lg:grid-cols-2 xl:grid-cols-3">
            {sortedDatarooms &&
              sortedDatarooms.map((dataroom) => (
                <li key={dataroom.id}>
                  <DataroomCard dataroom={dataroom} />
                </li>
              ))}
          </ul>

          {sortedDatarooms && sortedDatarooms.length === 0 && (
            <div className="flex items-center justify-center">
              <EmptyDataroom />
            </div>
          )}
        </div>
      </main>
    </AppLayout>
  );
}
