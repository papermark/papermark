import { useRouter } from "next/router";

import { useMemo } from "react";

import { useTeam } from "@/context/team-context";
import { Dataroom, DataroomDocument, DataroomFolder } from "@prisma/client";
import { toast } from "sonner";
import useSWR from "swr";

import { LinkWithViews } from "@/lib/types";
import { fetcher } from "@/lib/utils";
import { sortByIndexThenName } from "@/lib/utils/sort-items-by-index-name";

export type DataroomFolderWithCount = DataroomFolder & {
  _count: {
    documents: number;
    childFolders: number;
  };
};

export function useDataroom() {
  const router = useRouter();

  const { id } = router.query as {
    id: string;
  };

  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  // Only make the API call if we're on a dataroom page
  const isDataroomPage = router.pathname.startsWith("/datarooms");
  const shouldFetch = teamId && id && isDataroomPage;

  const { data: dataroom, error } = useSWR<
    Dataroom & {
      _count?: { viewerGroups: number; permissionGroups: number };
      tags?: {
        tag: {
          id: string;
          name: string;
          color: string;
          description: string | null;
        };
      }[];
    }
  >(shouldFetch ? `/api/teams/${teamId}/datarooms/${id}` : null, fetcher, {
    dedupingInterval: 10000,
    onError: (err) => {
      if (err.status === 404) {
        toast.error("Dataroom not found", {
          description:
            "The dataroom you're looking for doesn't exist or has been moved.",
        });
        router.replace("/datarooms");
      }
    },
  });

  return {
    dataroom,
    loading: !error && !dataroom,
    error,
  };
}

export function useDataroomLinks() {
  const router = useRouter();

  const { id } = router.query as {
    id: string;
  };

  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: links, error } = useSWR<LinkWithViews[]>(
    teamId && id && `/api/teams/${teamId}/datarooms/${id}/links`,
    fetcher,
    { dedupingInterval: 10000 },
  );

  return {
    links,
    loading: !error && !links,
    error,
  };
}

export function useDataroomItems({
  root,
  name,
}: {
  root?: boolean;
  name?: string[];
}) {
  const router = useRouter();
  const { id } = router.query as {
    id: string;
  };
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: folderData, error: folderError } = useSWR<
    DataroomFolderWithCount[]
  >(
    teamId &&
      id &&
      `/api/teams/${teamId}/datarooms/${id}/folders${root ? "?root=true" : name ? `/${name.join("/")}` : ""}`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    },
  );

  const { data: documentData, error: documentError } = useSWR<
    DataroomFolderDocument[]
  >(
    teamId &&
      id &&
      `/api/teams/${teamId}/datarooms/${id}${name ? `/folders/documents/${name.join("/")}` : "/documents"}`,

    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    },
  );

  const isLoading =
    !folderData && !documentData && !folderError && !documentError;
  const error = folderError || documentError;

  const combinedItems = useMemo(() => {
    if (!folderData && !documentData) return [];

    const allItems = [
      ...(folderData || []).map((folder) => ({
        ...folder,
        itemType: "folder",
      })),
      ...(documentData || []).map((doc) => ({ ...doc, itemType: "document" })),
    ];
    return sortByIndexThenName(allItems);
  }, [folderData, documentData]);

  return {
    items: combinedItems as (
      | (DataroomFolderWithCount & { itemType: "folder" })
      | (DataroomFolderDocument & { itemType: "document" })
    )[],
    folderCount: folderData?.length || 0,
    documentCount: documentData?.length || 0,
    isLoading,
    error,
  };
}

export function useDataroomDocuments() {
  const router = useRouter();

  const { id } = router.query as {
    id: string;
  };

  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: documents, error } = useSWR<DataroomFolderDocument[]>(
    teamId && id && `/api/teams/${teamId}/datarooms/${id}/documents`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    },
  );

  return {
    documents,
    loading: !documents && !error,
    error,
  };
}

export function useDataroomFolders({
  root,
  name,
}: {
  root?: boolean;
  name?: string[];
}) {
  const router = useRouter();

  const { id } = router.query as {
    id: string;
  };

  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: folders, error } = useSWR<DataroomFolderWithCount[]>(
    teamId &&
      id &&
      `/api/teams/${teamId}/datarooms/${id}/folders${root ? "?root=true" : name ? `/${name.join("/")}` : ""}`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    },
  );

  return {
    folders,
    loading: !folders && !error,
    error,
  };
}

export type DataroomFolderWithDocuments = DataroomFolder & {
  childFolders: DataroomFolderWithDocuments[];
  documents: {
    orderIndex: number | null;
    id: string;
    folderId: string;
    hierarchicalIndex: string | null;
    document: {
      id: string;
      name: string;
      type: string;
    };
  }[];
};

export function useDataroomFoldersTree({
  dataroomId,
  include_documents,
}: {
  dataroomId: string;
  include_documents?: boolean;
}) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: folders, error } = useSWR<DataroomFolderWithDocuments[]>(
    teamId &&
      `/api/teams/${teamId}/datarooms/${dataroomId}/folders${include_documents ? "?include_documents=true" : ""}`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    },
  );

  return {
    folders,
    loading: !folders && !error,
    error,
  };
}

export function useDataroomFolderWithParents({
  name,
  dataroomId,
}: {
  name: string[];
  dataroomId: string;
}) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: folders, error } = useSWR<{ name: string; path: string }[]>(
    teamId &&
      name &&
      !!name.length &&
      `/api/teams/${teamId}/datarooms/${dataroomId}/folders/parents/${name.join("/")}`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    },
  );

  return {
    folders,
    loading: !folders && !error,
    error,
  };
}

export type DataroomFolderDocument = DataroomDocument & {
  document: {
    id: string;
    name: string;
    type: string;
    advancedExcelEnabled?: boolean;
    versions?: { id: string; hasPages: boolean }[];
    isExternalUpload?: boolean;
    _count: {
      views: number;
      versions: number;
    };
  };
};

export function useDataroomFolderDocuments({ name }: { name: string[] }) {
  const router = useRouter();

  const { id } = router.query as {
    id: string;
  };

  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: documents, error } = useSWR<DataroomFolderDocument[]>(
    teamId &&
      id &&
      name &&
      `/api/teams/${teamId}/datarooms/${id}/folders/documents/${name.join("/")}`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    },
  );

  return {
    documents,
    loading: !documents && !error,
    error,
  };
}

export function useDataroomViewers({ dataroomId }: { dataroomId: string }) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: viewers, error } = useSWR<any[]>(
    teamId &&
      dataroomId &&
      `/api/teams/${teamId}/datarooms/${dataroomId}/viewers`,
    fetcher,
    {
      dedupingInterval: 10000,
    },
  );

  return {
    viewers,
    loading: !error && !viewers,
    error,
  };
}

type DataroomVisitsResponse = {
  views: any[];
  hiddenFromPause: number;
};

export function useDataroomVisits({
  dataroomId,
  groupId,
}: {
  dataroomId: string;
  groupId?: string;
}) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data, error } = useSWR<DataroomVisitsResponse>(
    teamId &&
      dataroomId &&
      `/api/teams/${teamId}/datarooms/${dataroomId}${groupId ? `/groups/${groupId}` : ""}/views`,
    fetcher,
    {
      dedupingInterval: 10000,
    },
  );

  return {
    views: data?.views,
    hiddenFromPause: data?.hiddenFromPause ?? 0,
    loading: !error && !data,
    error,
  };
}

type DataroomDocumentViewHistory = {
  id: string;
  downloadedAt: string;
  viewedAt: string;
  downloadType?: "SINGLE" | "BULK" | "FOLDER";
  downloadMetadata?: {
    folderName?: string;
    folderPath?: string;
    dataroomName?: string;
    documentCount?: number;
    documents?: {
      id: string;
      name: string;
    }[];
  };
  document: {
    id: string;
    name: string;
  };
};

type DataroomDocumentUploadViewHistory = {
  uploadedAt: string;
  documentId: string;
  originalFilename: string;
};

export function useDataroomVisitHistory({
  viewId,
  dataroomId,
}: {
  viewId: string;
  dataroomId: string;
}) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data, error } = useSWR<{
    documentViews: DataroomDocumentViewHistory[];
    uploadedDocumentViews: DataroomDocumentUploadViewHistory[];
  }>(
    teamId &&
      dataroomId &&
      `/api/teams/${teamId}/datarooms/${dataroomId}/views/${viewId}/history`,
    fetcher,
    {
      dedupingInterval: 10000,
    },
  );

  return {
    documentViews: data?.documentViews,
    uploadedDocumentViews: data?.uploadedDocumentViews,
    loading: !error && !data,
    error,
  };
}

export type DataroomDocumentViewStats = {
  duration: {
    data: { pageNumber: string; sum_duration: number }[];
  };
  total_duration: number;
  numPages: number;
  versionNumber?: number;
  documentName: string;
};

export function useDataroomDocumentViewStats({
  dataroomId,
  documentId,
  viewId,
}: {
  dataroomId: string;
  documentId: string;
  viewId: string;
}) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: stats, error } = useSWR<DataroomDocumentViewStats>(
    teamId &&
      dataroomId &&
      documentId &&
      viewId &&
      `/api/teams/${teamId}/datarooms/${dataroomId}/documents/${documentId}/views/${viewId}/stats`,
    fetcher,
    {
      dedupingInterval: 10000,
    },
  );

  return {
    stats,
    loading: !error && !stats,
    error,
  };
}
