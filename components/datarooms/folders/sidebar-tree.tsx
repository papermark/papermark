import { useRouter } from "next/router";

import { memo, useMemo } from "react";

import { HomeIcon } from "lucide-react";

import {
  DataroomFolderWithDocuments,
  useDataroomFoldersTree,
} from "@/lib/swr/use-dataroom";
import { cn } from "@/lib/utils";
import {
  HIERARCHICAL_DISPLAY_STYLE,
  useHierarchicalDisplayName,
} from "@/lib/utils/hierarchical-display";
import { sortByIndexThenName } from "@/lib/utils/sort-items-by-index-name";

import { FileTree } from "@/components/ui/nextra-filetree";

import { buildNestedFolderStructure } from "./utils";

type MixedItem =
  | (DataroomFolderWithDocuments & { itemType: "folder" })
  | (DataroomFolderWithDocuments["documents"][0] & { itemType: "document" });

const DocumentFileItem = memo(
  ({
    document,
    dataroomId,
    router,
  }: {
    document: DataroomFolderWithDocuments["documents"][0] & {
      itemType: "document";
    };
    dataroomId: string;
    router: any;
  }) => {
    const documentDisplayName = useHierarchicalDisplayName(
      document.document.name,
      document.hierarchicalIndex,
    );

    return (
      <FileTree.File
        name={documentDisplayName}
        onToggle={() =>
          router.push(`/datarooms/${dataroomId}/document/${document.id}`)
        }
      />
    );
  },
);
DocumentFileItem.displayName = "DocumentFileItem";

const FolderComponent = memo(
  ({
    dataroomId,
    folder,
  }: {
    dataroomId: string;
    folder: DataroomFolderWithDocuments;
  }) => {
    const router = useRouter();

    // Get hierarchical display names
    const folderDisplayName = useHierarchicalDisplayName(
      folder.name,
      folder.hierarchicalIndex,
    );

    const mixedItems = useMemo(() => {
      const allItems: MixedItem[] = [
        ...(folder.childFolders || []).map((f) => ({
          ...f,
          itemType: "folder" as const,
        })),
        ...(folder.documents || []).map((d) => ({
          ...d,
          itemType: "document" as const,
        })),
      ];

      return sortByIndexThenName(allItems);
    }, [folder.childFolders, folder.documents]);

    const renderedItems = useMemo(
      () =>
        mixedItems.map((item: MixedItem) => {
          if (item.itemType === "folder") {
            return (
              <FolderComponent
                key={item.id}
                dataroomId={dataroomId}
                folder={item}
              />
            );
          } else {
            return (
              <DocumentFileItem
                key={item.id}
                document={item}
                dataroomId={dataroomId}
                router={router}
              />
            );
          }
        }),
      [mixedItems, dataroomId, router],
    );

    const isActive =
      folder.path === "/" + (router.query.name as string[])?.join("/");
    const isChildActive = folder.childFolders.some(
      (childFolder) =>
        childFolder.path === "/" + (router.query.name as string[])?.join("/"),
    );

    const handleFolderClick = () => {
      router.push(
        `/datarooms/${dataroomId}/documents${folder.path}`,
        `/datarooms/${dataroomId}/documents${folder.path}`,
        {
          scroll: false,
        },
      );
    };

    return (
      <FileTree.Folder
        name={folderDisplayName}
        key={folder.id}
        active={isActive}
        childActive={isChildActive}
        onToggle={handleFolderClick}
      >
        {renderedItems}
      </FileTree.Folder>
    );
  },
);
FolderComponent.displayName = "FolderComponent";

const SidebarFolders = ({
  dataroomId,
  folders,
}: {
  dataroomId: string;
  folders: DataroomFolderWithDocuments[];
}) => {
  const nestedFolders = useMemo(() => {
    if (folders) {
      return buildNestedFolderStructure(folders);
    }
    return [];
  }, [folders, dataroomId]);

  return (
    <FileTree>
      <SidebarLink
        href={`/datarooms/${dataroomId}/documents`}
        label={"Home"}
      />
      {nestedFolders.map((folder) => (
        <FolderComponent
          key={folder.id}
          dataroomId={dataroomId}
          folder={folder}
        />
      ))}
    </FileTree>
  );
};

export function SidebarFolderTree({ dataroomId }: { dataroomId: string }) {
  const { folders, error } = useDataroomFoldersTree({ dataroomId });

  if (!folders || error) return null;

  return <SidebarFolders dataroomId={dataroomId} folders={folders} />;
}

export const SidebarLink = memo(
  ({ href, label }: { href: string; label: string }) => {
    const router = useRouter();
    const isActive = router.asPath === href;

    return (
      <li
        className={cn(
          "flex list-none rounded-md",
          "text-foreground transition-all duration-200 ease-in-out",
          "hover:bg-gray-100 hover:shadow-sm hover:dark:bg-muted",
          "px-3 py-1.5 leading-6",
          isActive && "bg-gray-100 font-semibold dark:bg-muted",
        )}
      >
        <span
          className="inline-flex w-full cursor-pointer items-center"
          onClick={() => router.push(href)}
        >
          <HomeIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="ml-2 w-fit truncate" title={label}>
            {label}
          </span>
        </span>
      </li>
    );
  },
);

SidebarLink.displayName = "SidebarLink";
