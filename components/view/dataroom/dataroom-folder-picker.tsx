import { useMemo } from "react";

import { DataroomFolder } from "@prisma/client";
import { ChevronDownIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { buildNestedFolderStructure } from "@/components/datarooms/folders/utils";
import { cn } from "@/lib/utils";
import {
  HIERARCHICAL_DISPLAY_STYLE,
  getHierarchicalDisplayName,
} from "@/lib/utils/hierarchical-display";
import { sortByIndexThenName } from "@/lib/utils/sort-items-by-index-name";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useViewerSurfaceTheme } from "@/components/view/viewer/viewer-surface-theme";

type NestedFolder = DataroomFolder & { childFolders: NestedFolder[] };

function sortNestedFolders(nodes: NestedFolder[]): NestedFolder[] {
  return sortByIndexThenName(nodes).map((n) => ({
    ...n,
    childFolders: sortNestedFolders(n.childFolders ?? []),
  }));
}

function FolderPickerBranch({
  nodes,
  depth,
  folderId,
  setFolderId,
  dataroomIndexEnabled,
  activeBg,
  textColor,
}: {
  nodes: NestedFolder[];
  depth: number;
  folderId: string | null;
  setFolderId: React.Dispatch<React.SetStateAction<string | null>>;
  dataroomIndexEnabled?: boolean;
  activeBg: string;
  textColor: string;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.id}>
          <DropdownMenuItem
            className={cn(
              "cursor-pointer focus:text-inherit",
              folderId === node.id && "font-medium",
            )}
            style={{
              paddingLeft: `${0.75 + depth * 0.65}rem`,
              color: textColor,
              backgroundColor:
                folderId === node.id ? activeBg : undefined,
              ...HIERARCHICAL_DISPLAY_STYLE,
            }}
            onClick={() => setFolderId(node.id)}
          >
            {getHierarchicalDisplayName(
              node.name,
              node.hierarchicalIndex,
              dataroomIndexEnabled ?? false,
            )}
          </DropdownMenuItem>
          {node.childFolders?.length ? (
            <FolderPickerBranch
              nodes={node.childFolders}
              depth={depth + 1}
              folderId={folderId}
              setFolderId={setFolderId}
              dataroomIndexEnabled={dataroomIndexEnabled}
              activeBg={activeBg}
              textColor={textColor}
            />
          ) : null}
        </div>
      ))}
    </>
  );
}

export function DataroomFolderPicker({
  folders,
  folderId,
  setFolderId,
  dataroomIndexEnabled,
  className,
}: {
  folders: DataroomFolder[];
  folderId: string | null;
  setFolderId: React.Dispatch<React.SetStateAction<string | null>>;
  dataroomIndexEnabled?: boolean;
  className?: string;
}) {
  const { palette } = useViewerSurfaceTheme();
  const { t } = useTranslation("dataroom");

  const nested = useMemo(() => {
    const roots = buildNestedFolderStructure(folders as any) as NestedFolder[];
    return sortNestedFolders(roots);
  }, [folders]);

  const triggerLabel = useMemo(() => {
    if (folderId === null) {
      return t("folderPicker.home", "Home");
    }
    const current = folders.find((f) => f.id === folderId);
    if (!current) return t("folderPicker.home", "Home");
    return getHierarchicalDisplayName(
      current.name,
      current.hierarchicalIndex,
      dataroomIndexEnabled ?? false,
    );
  }, [folderId, folders, dataroomIndexEnabled, t]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-9 max-w-[min(100%,280px)] shrink-0 justify-between gap-2 px-3 text-left text-sm font-normal shadow-sm",
            className,
          )}
          style={{
            borderColor: palette.controlBorderColor,
            backgroundColor: palette.controlBgColor,
            color: palette.textColor,
          }}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[min(70vh,360px)] w-[min(calc(100vw-2rem),300px)] overflow-y-auto border"
        style={{
          backgroundColor: palette.panelBgColor,
          borderColor: palette.panelBorderColor,
          color: palette.textColor,
        }}
      >
        <DropdownMenuItem
          className={cn(
            "cursor-pointer focus:text-inherit",
            folderId === null && "font-medium",
          )}
          style={{
            ...HIERARCHICAL_DISPLAY_STYLE,
            color: palette.textColor,
            backgroundColor:
              folderId === null ? palette.controlBgColor : undefined,
          }}
          onClick={() => setFolderId(null)}
        >
          {t("folderPicker.home", "Home")}
        </DropdownMenuItem>
        {nested.length > 0 ? <DropdownMenuSeparator /> : null}
        <FolderPickerBranch
          nodes={nested}
          depth={0}
          folderId={folderId}
          setFolderId={setFolderId}
          dataroomIndexEnabled={dataroomIndexEnabled}
          activeBg={palette.controlBgColor}
          textColor={palette.textColor}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
