import { useRouter } from "next/router";

import { useTeam } from "@/context/team-context";

import { AddDocumentDropdown } from "@/components/documents/add-document-dropdown";
import { DocumentsList } from "@/components/documents/documents-list";
import AppLayout from "@/components/layouts/app";
import { Separator } from "@/components/ui/separator";

import { useFolder, useFolderDocuments } from "@/lib/swr/use-documents";

export default function DocumentTreePage() {
  const router = useRouter();
  const { name } = router.query as { name: string[] };

  const { folders, loading: foldersLoading } = useFolder({ name });
  const { documents, loading } = useFolderDocuments({ name });
  const teamInfo = useTeam();

  return (
    <AppLayout>
      <main className="p-4 sm:m-4 sm:px-4 sm:py-4">
        <section className="mb-4 mt-4 flex items-center justify-between md:mb-8 lg:mb-12">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              All Documents
            </h2>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Manage all your documents in one place.
            </p>
          </div>
          <div className="flex items-center gap-x-2">
            <AddDocumentDropdown variant="split" />
          </div>
        </section>

        {/* Portaled in from DocumentsList component */}
        <section id="documents-header-count" />

        <Separator className="mb-5 bg-gray-200 dark:bg-gray-800" />

        <DocumentsList
          documents={documents}
          folders={folders}
          teamInfo={teamInfo}
          folderPathName={name}
          loading={loading}
          foldersLoading={foldersLoading}
        />
      </main>
    </AppLayout>
  );
}
