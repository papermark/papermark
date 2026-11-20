import Link from "next/link";

import { useTeam } from "@/context/team-context";
import { ArrowLeftIcon, EyeOffIcon } from "lucide-react";

import { useHiddenDocuments } from "@/lib/swr/use-documents";

import { HiddenDocumentsList } from "@/components/documents/hidden-documents-list";
import AppLayout from "@/components/layouts/app";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export default function HiddenDocumentsPage() {
  const teamInfo = useTeam();
  const { folders, documents, loading } = useHiddenDocuments();

  return (
    <AppLayout>
      <div className="sticky top-0 mb-4 min-h-[calc(100vh-72px)] rounded-lg bg-white p-3 dark:bg-gray-900 sm:mx-4 sm:p-4 sm:pt-8">
        <section className="mb-4 flex items-center justify-between space-x-2 sm:space-x-0">
          <div className="space-y-0 sm:space-y-1">
            <div className="flex items-center gap-x-2">
              <Link href="/documents">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ArrowLeftIcon className="h-4 w-4" />
                </Button>
              </Link>
              <div className="flex items-center gap-x-2">
                <EyeOffIcon className="h-6 w-6 text-muted-foreground" />
                <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  Hidden Documents
                </h2>
              </div>
            </div>
            <p className="ml-10 text-xs leading-4 text-muted-foreground sm:text-sm sm:leading-none">
              Documents and folders hidden from All Documents. You can unhide
              them to show them again.
            </p>
          </div>
        </section>

        <section id="documents-header-count" />

        <Separator className="mb-5 bg-gray-200 dark:bg-gray-800" />

        <HiddenDocumentsList
          documents={documents}
          folders={folders}
          teamInfo={teamInfo}
          loading={loading}
          foldersLoading={loading}
        />
      </div>
    </AppLayout>
  );
}
