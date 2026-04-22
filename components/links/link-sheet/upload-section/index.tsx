import React, { useEffect, useMemo, useState } from "react";

import { CircleHelpIcon, FolderIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";

import { FADE_IN_ANIMATION_SETTINGS } from "@/lib/constants";

import { SidebarFolderTreeSelection as DataroomFolderTree } from "@/components/datarooms/folders";
import { TSelectedFolder } from "@/components/documents/move-folder-modal";
import { SidebarFolderTreeSelection as AllDocFolderTree } from "@/components/sidebar-folders";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { BadgeTooltip } from "@/components/ui/tooltip";

import { DEFAULT_LINK_TYPE } from "..";
import LinkItem from "../link-item";
import { LinkUpgradeOptions } from "../link-options";

type UploadFolderSummary = {
  id: string;
  name: string;
  path?: string | null;
};

/**
 * Single-folder selection modal used for document links / all-documents scope.
 * Dataroom links use `MultiFolderSelectionModal` below because an admin may now
 * grant upload access to more than one folder.
 */
function SingleFolderSelectionModal({
  open,
  setOpen,
  dataroomId,
  currentFolder,
  handleSelectFolder,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  dataroomId: string;
  currentFolder: TSelectedFolder | null;
  handleSelectFolder: (selectedFolder: TSelectedFolder | null) => void;
}) {
  const [selectedFolder, setSelectedFolder] = useState<TSelectedFolder | null>(
    currentFolder,
  );

  const handleSubmit = async (event: any) => {
    event.preventDefault();
    event.stopPropagation();
    handleSelectFolder(selectedFolder);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <div className="flex">
          <div className="flex w-full cursor-pointer rounded-md border border-input bg-white text-foreground placeholder-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-inset focus:ring-muted-foreground dark:border-gray-500 dark:bg-gray-800 focus:dark:bg-transparent sm:text-sm">
            <div className="flex w-full items-center px-3 py-2">
              {selectedFolder ? (
                <div className="relative w-full">
                  <span className="flex items-center gap-1">
                    <FolderIcon className="mr-1 h-4 w-4" />{" "}
                    {selectedFolder.name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFolder(null);
                      handleSelectFolder(null);
                    }}
                    className="pointer-events-auto absolute inset-y-0 right-0 z-10 -mr-1 flex items-center rounded-md p-1 hover:bg-muted"
                  >
                    <XIcon className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              ) : (
                <span className="text-muted-foreground">
                  Optionally, select folder
                </span>
              )}
            </div>
          </div>
        </div>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader className="text-start">
          <DialogTitle>Select Folder</DialogTitle>
          <DialogDescription>
            Select folder location to upload file.
          </DialogDescription>
        </DialogHeader>
        <form>
          <div className="mb-2 max-h-[75vh] overflow-x-hidden overflow-y-scroll">
            {dataroomId && dataroomId !== "all_documents" ? (
              <DataroomFolderTree
                dataroomId={dataroomId}
                selectedFolder={selectedFolder}
                setSelectedFolder={setSelectedFolder}
              />
            ) : (
              <AllDocFolderTree
                selectedFolder={selectedFolder}
                setSelectedFolder={setSelectedFolder}
              />
            )}
          </div>

          <DialogFooter>
            <Button
              onClick={handleSubmit}
              className="flex h-9 w-full gap-1"
              disabled={!selectedFolder}
            >
              {!selectedFolder ? (
                "Select a folder"
              ) : (
                <>
                  Select{" "}
                  <span className="max-w-[200px] truncate font-medium">
                    {selectedFolder.name}
                  </span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Multi-folder picker for dataroom links. Reuses the single-select tree UI but
 * accumulates folders into a local set each time the admin picks one in the
 * dialog. Already-selected folders are surfaced as removable chips in the
 * trigger so the admin can easily prune the allow-list.
 */
function MultiFolderSelectionModal({
  dataroomId,
  selectedFolders,
  onChange,
}: {
  dataroomId: string;
  selectedFolders: UploadFolderSummary[];
  onChange: (folders: UploadFolderSummary[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftFolder, setDraftFolder] = useState<TSelectedFolder | null>(null);

  // Folders already in the allow-list shouldn't be picked again from the tree.
  const disableIds = useMemo(
    () => selectedFolders.map((f) => f.id),
    [selectedFolders],
  );

  const addDraft = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!draftFolder?.id) return;
    const exists = selectedFolders.some((f) => f.id === draftFolder.id);
    if (!exists) {
      onChange([
        ...selectedFolders,
        {
          id: draftFolder.id,
          name: draftFolder.name,
          path: draftFolder.path ?? null,
        },
      ]);
    }
    setDraftFolder(null);
    setOpen(false);
  };

  const removeFolder = (id: string) => {
    onChange(selectedFolders.filter((f) => f.id !== id));
  };

  return (
    <div className="space-y-2">
      {selectedFolders.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedFolders.map((folder) => (
            <span
              key={folder.id}
              className="inline-flex items-center gap-1 rounded-md border border-input bg-muted/40 px-2 py-1 text-sm"
              title={folder.path ?? folder.name}
            >
              <FolderIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="max-w-[220px] truncate">{folder.name}</span>
              <button
                type="button"
                onClick={() => removeFolder(folder.id)}
                className="rounded p-0.5 hover:bg-muted"
                aria-label={`Remove ${folder.name}`}
              >
                <XIcon className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setDraftFolder(null);
        }}
      >
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center rounded-md border border-dashed border-input bg-white px-3 py-2 text-left text-sm text-muted-foreground hover:border-muted-foreground dark:border-gray-500 dark:bg-gray-800"
          >
            {selectedFolders.length === 0
              ? "Optionally, select one or more folders"
              : "Add another folder"}
          </button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader className="text-start">
            <DialogTitle>Select Folder</DialogTitle>
            <DialogDescription>
              Add a folder to the upload allow-list. You can add more than one.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="mb-2 max-h-[75vh] overflow-x-hidden overflow-y-scroll">
              <DataroomFolderTree
                dataroomId={dataroomId}
                selectedFolder={draftFolder}
                setSelectedFolder={setDraftFolder}
                disableId={disableIds}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                onClick={addDraft}
                className="flex h-9 w-full gap-1"
                disabled={!draftFolder}
              >
                {!draftFolder ? (
                  "Select a folder"
                ) : (
                  <>
                    Add{" "}
                    <span className="max-w-[200px] truncate font-medium">
                      {draftFolder.name}
                    </span>
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function UploadSection({
  data,
  setData,
  isAllowed,
  handleUpgradeStateChange,
  targetId,
}: {
  data: DEFAULT_LINK_TYPE;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_LINK_TYPE>>;
  isAllowed: boolean;
  handleUpgradeStateChange: ({
    state,
    trigger,
    plan,
  }: LinkUpgradeOptions) => void;
  targetId: string;
}) {
  const {
    enableUpload,
    uploadFolderId,
    uploadFolderName,
    uploadFolderIds,
    uploadFolders,
  } = data;
  const [enabled, setEnabled] = useState<boolean>(false);
  // Legacy single-folder selection kept for document links / all-documents.
  const [legacyFolder, setLegacyFolder] = useState<TSelectedFolder | null>(
    null,
  );
  const [open, setOpen] = useState<boolean>(false);

  const isDataroomTarget = !!targetId && targetId !== "all_documents";

  useEffect(() => {
    setEnabled(enableUpload!);
  }, [enableUpload]);

  // Hydrate the legacy single-folder selection for the all-documents picker.
  useEffect(() => {
    if (uploadFolderId) {
      setLegacyFolder({ id: uploadFolderId, name: uploadFolderName });
    }
  }, [uploadFolderId, uploadFolderName]);

  // Normalise the allow-list of folders shown as chips for dataroom links.
  const selectedFolders = useMemo<UploadFolderSummary[]>(() => {
    if (Array.isArray(uploadFolders) && uploadFolders.length > 0) {
      return uploadFolders.map((f) => ({
        id: f.id,
        name: f.name,
        path: f.path ?? null,
      }));
    }
    // Server didn't enrich folder metadata; synthesise names from the id list
    // using the legacy fields so the chip still has a meaningful label.
    if (Array.isArray(uploadFolderIds) && uploadFolderIds.length > 0) {
      return uploadFolderIds.map((id) => ({
        id,
        name:
          id === uploadFolderId && uploadFolderName
            ? uploadFolderName
            : "Folder",
      }));
    }
    if (uploadFolderId) {
      return [
        {
          id: uploadFolderId,
          name: uploadFolderName || "Folder",
        },
      ];
    }
    return [];
  }, [uploadFolders, uploadFolderIds, uploadFolderId, uploadFolderName]);

  const handleUpload = async () => {
    const updatedUpload = !enabled;
    setData({
      ...data,
      enableUpload: updatedUpload,
    });
    setEnabled(updatedUpload);
  };

  const handleLegacySelectFolder = (
    selectedFolder: TSelectedFolder | null,
  ): void => {
    setLegacyFolder(selectedFolder);
    setData({
      ...data,
      uploadFolderId: selectedFolder?.id ?? null,
      uploadFolderName: selectedFolder?.name || "Home",
      uploadFolderIds: selectedFolder?.id ? [selectedFolder.id] : [],
      uploadFolders: selectedFolder?.id
        ? [{ id: selectedFolder.id, name: selectedFolder.name }]
        : [],
    });
  };

  const handleMultiChange = (folders: UploadFolderSummary[]): void => {
    setData({
      ...data,
      uploadFolderIds: folders.map((f) => f.id),
      uploadFolders: folders,
      // Keep the legacy columns in sync so existing consumers keep working.
      uploadFolderId: folders[0]?.id ?? null,
      uploadFolderName: folders[0]?.name ?? "Home",
    });
  };

  return (
    <div className="pb-5">
      <LinkItem
        title="Enable file requests"
        tooltipContent="Visitors can upload files to the dataroom."
        enabled={enabled}
        action={handleUpload}
        isAllowed={isAllowed}
        requiredPlan="data rooms plus"
        upgradeAction={() =>
          handleUpgradeStateChange({
            state: true,
            trigger: "link_sheet_upload_section",
            plan: "Data Rooms Plus",
            highlightItem: ["requests"],
          })
        }
      />

      {enabled && (
        <motion.div
          className="relative mt-4 space-y-3"
          {...FADE_IN_ANIMATION_SETTINGS}
        >
          <div className="flex w-full flex-col items-start gap-6 overflow-x-visible pb-4 pt-0">
            <div className="w-full space-y-4">
              <div className="space-y-4">
                <Label
                  htmlFor="link-folder"
                  className="flex flex-col items-start gap-2"
                >
                  <div className="flex items-center gap-2">
                    <span>
                      {isDataroomTarget
                        ? "Upload to specific folder(s)"
                        : "Upload to specific folder"}
                    </span>
                    <BadgeTooltip
                      content={
                        isDataroomTarget
                          ? "Add one or more folders where visitors may upload. When multiple are allowed, the visitor picks one at upload time (the folder they are currently browsing is pre-selected when it's on the list). Leave empty to let visitors choose any folder."
                          : "This is the folder that will be used to store uploaded files. If you don't select a folder, the files will be uploaded to the folder the visitor chooses."
                      }
                    >
                      <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
                    </BadgeTooltip>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    Leave blank for visitor to choose folder
                  </span>
                </Label>
                {isDataroomTarget ? (
                  <MultiFolderSelectionModal
                    dataroomId={targetId}
                    selectedFolders={selectedFolders}
                    onChange={handleMultiChange}
                  />
                ) : (
                  <SingleFolderSelectionModal
                    open={open}
                    setOpen={setOpen}
                    dataroomId={targetId}
                    currentFolder={legacyFolder}
                    handleSelectFolder={handleLegacySelectFolder}
                  />
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
