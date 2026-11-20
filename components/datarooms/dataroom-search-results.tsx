import Link from "next/link";
import { useRouter } from "next/router";

import { TeamContextType } from "@/context/team-context";
import { ChevronRight, FileIcon, FolderIcon } from "lucide-react";

import {
  DataroomFolderDocumentWithPath,
  DataroomFolderWithCountAndPath,
} from "@/lib/swr/use-dataroom";
import { safeSlugify } from "@/lib/utils";

import DataroomDocumentCard from "@/components/datarooms/dataroom-document-card";
import FolderCard from "@/components/documents/folder-card";

function FolderPathBreadcrumb({
  folderPath,
  dataroomId,
}: {
  folderPath: string[];
  dataroomId: string;
}) {
  const router = useRouter();
  const { id } = router.query as { id: string };

  const buildLink = (index: number) => {
    if (index < 0) return `/datarooms/${id}/documents`;
    const slugs = folderPath.slice(0, index + 1).map(safeSlugify);
    return `/datarooms/${id}/documents/${slugs.join("/")}`;
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1 text-xs leading-5 text-muted-foreground">
      <p className="flex items-center gap-x-1">
        <FolderIcon className="h-3 w-3" />
        <Link
          href={`/datarooms/${id}/documents`}
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 hover:underline"
        >
          Root
        </Link>
      </p>
      {folderPath.map((name, index) => (
        <p key={index} className="flex items-center gap-x-1">
          <ChevronRight className="h-3 w-3" />
          <FolderIcon className="h-3 w-3" />
          <Link
            href={buildLink(index)}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 hover:underline"
          >
            {name}
          </Link>
        </p>
      ))}
    </div>
  );
}

export function DataroomSearchResults({
  documents,
  folders,
  teamInfo,
  dataroomId,
  searchQuery,
}: {
  documents: DataroomFolderDocumentWithPath[];
  folders: DataroomFolderWithCountAndPath[];
  teamInfo: TeamContextType | null;
  dataroomId: string;
  searchQuery: string;
}) {
  const totalResults = documents.length + folders.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-x-2 text-sm text-muted-foreground">
        <span>
          Search results for &quot;{searchQuery}&quot;
        </span>
        <span className="text-xs">
          ({totalResults} result{totalResults !== 1 ? "s" : ""})
        </span>
      </div>

      {totalResults === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <p className="text-sm text-muted-foreground">
            No documents or folders found matching &quot;{searchQuery}&quot;
          </p>
        </div>
      ) : (
        <ul role="list" className="space-y-4">
          {folders.length > 0 && (
            <>
              <li className="flex items-center gap-x-1 text-sm text-muted-foreground">
                <FolderIcon className="h-4 w-4" />
                <span>
                  {folders.length} folder{folders.length !== 1 ? "s" : ""}
                </span>
              </li>
              {folders.map((folder) => (
                <li key={`folder-${folder.id}`}>
                  <div>
                    <FolderCard
                      folder={folder}
                      teamInfo={teamInfo}
                      isDataroom={true}
                      dataroomId={dataroomId}
                    />
                    {folder.folderPath.length > 0 && (
                      <div className="ml-4 mt-1">
                        <FolderPathBreadcrumb
                          folderPath={folder.folderPath}
                          dataroomId={dataroomId}
                        />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </>
          )}

          {documents.length > 0 && (
            <>
              <li className="flex items-center gap-x-1 text-sm text-muted-foreground">
                <FileIcon className="h-4 w-4" />
                <span>
                  {documents.length} document
                  {documents.length !== 1 ? "s" : ""}
                </span>
              </li>
              {documents.map((doc) => (
                <li key={`document-${doc.id}`}>
                  <div>
                    <DataroomDocumentCard
                      document={doc}
                      teamInfo={teamInfo}
                      dataroomId={dataroomId}
                    />
                    {doc.folderPath.length > 0 && (
                      <div className="ml-4 mt-1">
                        <FolderPathBreadcrumb
                          folderPath={doc.folderPath}
                          dataroomId={dataroomId}
                        />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
