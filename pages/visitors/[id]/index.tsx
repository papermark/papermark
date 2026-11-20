import ErrorPage from "next/error";
import Link from "next/link";
import { useRouter } from "next/router";

import { useEffect, useState } from "react";

import { usePlan } from "@/lib/swr/use-billing";
import useViewer from "@/lib/swr/use-viewer";

import AppLayout from "@/components/layouts/app";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactsDocumentsTable } from "@/components/visitors/contacts-document-table";
import { VisitorAccessCard } from "@/components/visitors/visitor-access-card";
import { VisitorAvatar } from "@/components/visitors/visitor-avatar";

export default function VisitorDetailPage() {
  const router = useRouter();
  const { isFree, isTrial } = usePlan();
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState("lastViewed");
  const [sortOrder, setSortOrder] = useState("desc");

  const { viewer, durations, loadingDurations, error } = useViewer(
    currentPage,
    pageSize,
    sortBy,
    sortOrder,
  );
  const views = viewer?.views;
  const pagination = viewer?.pagination;
  const sorting = viewer?.sorting;

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const handleSortChange = (newSortBy: string, newSortOrder: string) => {
    setSortBy(newSortBy);
    setSortOrder(newSortOrder);
    setCurrentPage(1);
  };

  useEffect(() => {
    if (isFree && !isTrial) router.push("/documents");
  }, [isTrial, isFree]);

  if (error) {
    return <ErrorPage statusCode={404} />;
  }

  return (
    <AppLayout>
      <div className="p-4 pb-0 sm:m-4 sm:py-4">
        {viewer ? (
          <section className="mb-4 flex flex-col justify-between md:mb-8 lg:mb-12">
            <div className="mt-2 flex items-center gap-x-2">
              <VisitorAvatar viewerEmail={viewer.email} />

              <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {viewer.email}
              </h2>
            </div>

            {viewer.access ? (
              <VisitorAccessCard access={viewer.access} />
            ) : null}
          </section>
        ) : (
          <VisitorDetailHeaderSkeleton />
        )}

        <Separator className="bg-gray-200 dark:bg-gray-800" />
      </div>

      <div className="relative p-4 pt-0 sm:mx-4 sm:mt-4">
        <ContactsDocumentsTable
          views={views}
          durations={durations}
          loadingDurations={loadingDurations}
          pagination={pagination}
          sorting={sorting}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          onSortChange={handleSortChange}
        />
      </div>
    </AppLayout>
  );
}

const VisitorDetailHeaderSkeleton = () => {
  return (
    <section className="mb-4 flex flex-col justify-between md:mb-8 lg:mb-12">
      <Breadcrumb className="hidden md:flex">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/visitors">All Visitors</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <Skeleton className="h-6 w-24 rounded-md" />
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="mt-2 flex items-center gap-x-2">
        <Skeleton className="hidden h-10 w-10 flex-shrink-0 rounded-full sm:inline-flex" />
        <Skeleton className="h-8 w-48 rounded-md sm:w-64" />
      </div>
    </section>
  );
};
