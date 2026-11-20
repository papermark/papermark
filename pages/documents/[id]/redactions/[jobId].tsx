import { useRouter } from "next/router";

import { RedactionWorkspace } from "@/ee/features/redaction/components/redaction-workspace";

import { useDocumentOverview } from "@/lib/swr/use-document-overview";

import AppLayout from "@/components/layouts/app";
import LoadingSpinner from "@/components/ui/loading-spinner";

/**
 * Full-page redaction workspace.
 *
 * The detection and apply phases run in background Trigger.dev tasks, so this
 * page is safe to close and revisit at any time — the job state lives on the
 * `DocumentRedactionJob` row and real-time progress is re-subscribed on load.
 */
export default function DocumentRedactionJobPage() {
  const router = useRouter();
  const { id, jobId } = router.query as { id?: string; jobId?: string };
  const { document: prismaDocument, loading } = useDocumentOverview();

  if (!id || !jobId || loading || !prismaDocument) {
    return (
      <AppLayout>
        <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
          <LoadingSpinner className="h-10 w-10" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <RedactionWorkspace
        documentId={id}
        documentName={prismaDocument.name}
        jobId={jobId}
      />
    </AppLayout>
  );
}
