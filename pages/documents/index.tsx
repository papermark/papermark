import { useRouter } from "next/router";

import Link from "next/link";

import { useTeam } from "@/context/team-context";
import { EyeOffIcon, FolderPlusIcon, PlusIcon } from "lucide-react";

import useDocuments, { useHiddenDocuments, useRootFolders } from "@/lib/swr/use-documents";
import { handleInvitationStatus } from "@/lib/utils";

import { AddDocumentModal } from "@/components/documents/add-document-modal";
import { DocumentsList } from "@/components/documents/documents-list";
import SortButton from "@/components/documents/filters/sort-button";
import { Pagination } from "@/components/documents/pagination";
import { AddFolderModal } from "@/components/folders/add-folder-modal";
import AppLayout from "@/components/layouts/app";
import { SearchBoxPersisted } from "@/components/search-box";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export default function Documents() {
  const router = useRouter();
  const teamInfo = useTeam();
  const queryParams = router.query;
  const currentPage = Number(queryParams["page"]) || 1;
  const pageSize = Number(queryParams["limit"]) || 10;
  const invitation = queryParams["invitation"] as "accepted" | "teamMember";

  // Handle invitation status
  if (invitation) {
    handleInvitationStatus(invitation, queryParams, router);
  }

  const { folders, loading: foldersLoading } = useRootFolders();
  const {
    documents,
    searchFolders,
    pagination,
    isValidating,
    isFiltered,
    loading,
  } = useDocuments();
  const { folders: hiddenFolders, documents: hiddenDocuments } =
    useHiddenDocuments();

  const hasHiddenItems =
    (hiddenFolders && hiddenFolders.length > 0) ||
    (hiddenDocuments && hiddenDocuments.length > 0);

  const updatePagination = (newPage?: number, newPageSize?: number) => {
    const params = new URLSearchParams(window.location.search);

    if (newPage) params.set("page", newPage.toString());
    if (newPageSize) {
      params.set("limit", newPageSize.toString());
      params.set("page", "1");
    }

    router.push(`/documents?${params.toString()}`, undefined, {
      shallow: true,
    });
  };

  const displayFolders = isFiltered ? searchFolders ?? [] : folders;

  return (
    <AppLayout>
      <div className="sticky top-0 mb-4 min-h-[calc(100vh-72px)] rounded-lg bg-white p-3 dark:bg-gray-900 sm:mx-4 sm:p-4 sm:pt-8">
        <section className="mb-4 flex items-center justify-between space-x-2 sm:space-x-0">
          <div className="space-y-0 sm:space-y-1">
            <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              All Documents
            </h2>
            <p className="text-xs leading-4 text-muted-foreground sm:text-sm sm:leading-none">
              Manage all your documents in one place.
            </p>
          </div>
          <div className="flex items-center gap-x-2">
            <AddDocumentModal>
              <Button
                className="group flex flex-1 items-center justify-start gap-x-1 whitespace-nowrap px-1 text-left sm:gap-x-3 sm:px-3"
                title="Add Document"
              >
                <PlusIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="text-xs sm:text-base">Add Document</span>
              </Button>
            </AddDocumentModal>
            <AddFolderModal>
              <Button
                size="icon"
                variant="outline"
                className="border-gray-500 bg-gray-50 hover:bg-gray-200 dark:bg-black hover:dark:bg-muted"
              >
                <FolderPlusIcon
                  className="h-5 w-5 shrink-0"
                  aria-hidden="true"
                />
              </Button>
            </AddFolderModal>
          </div>
        </section>

        <div className="mb-2 flex justify-end gap-x-2">
          <div className="relative w-full sm:max-w-xs">
            <SearchBoxPersisted loading={isValidating} inputClassName="h-10" />
          </div>
          <SortButton />
          {hasHiddenItems && (
            <Link href="/documents/hidden" aria-label="View hidden documents">
              <Button
                variant="outline"
                size="icon"
                className="border-gray-500 bg-gray-50 hover:bg-gray-200 dark:bg-black hover:dark:bg-muted"
              >
                <EyeOffIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
              </Button>
            </Link>
          )}
        </div>

        <section id="documents-header-count" />

        <Separator className="mb-5 bg-gray-200 dark:bg-gray-800" />

        <DocumentsList
          documents={documents}
          folders={displayFolders}
          teamInfo={teamInfo}
          loading={loading}
          foldersLoading={isFiltered ? loading : foldersLoading}
        />

        {isFiltered && pagination && (
          <Pagination
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={pagination.total}
            totalShownItems={documents.length}
            totalPages={pagination.pages}
            onPageChange={updatePagination}
            onPageSizeChange={(size) => updatePagination(undefined, size)}
            itemName="documents"
            extraInfo={
              searchFolders && searchFolders.length > 0
                ? `${searchFolders.length} folder${searchFolders.length > 1 ? "s" : ""} found`
                : undefined
            }
          />
        )}
      </div>
    </AppLayout>
  );
}
