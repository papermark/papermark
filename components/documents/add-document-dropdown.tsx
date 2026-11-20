import { useCallback, useMemo, useState } from "react";

import { PlanEnum } from "@/ee/stripe/constants";
import {
  ChevronDownIcon,
  FileUpIcon,
  FolderPlusIcon,
  FolderUpIcon,
  LinkIcon,
  PlusIcon,
  TablePropertiesIcon,
} from "lucide-react";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";

import { useUploadProgress } from "@/context/upload-progress-context";
import { usePlan } from "@/lib/swr/use-billing";
import useLimits from "@/lib/swr/use-limits";
import { cn } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { AddDocumentModal } from "@/components/documents/add-document-modal";
import { AddFolderModal } from "@/components/folders/add-folder-modal";
import { ImportFoldersModal } from "@/components/folders/import-folders-modal";
import NotionIcon from "@/components/shared/icons/files/notion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type DocModalState = {
  open: boolean;
  defaultTab: "document" | "notion";
  defaultUploadMode: "file" | "link";
};

interface AddDocumentDropdownProps {
  isDataroom?: boolean;
  dataroomId?: string;
  disabled?: boolean;
  size?: "default" | "sm";
  className?: string;
  variant?: "unified" | "split";
}

export function AddDocumentDropdown({
  isDataroom,
  dataroomId,
  disabled,
  size = "default",
  className,
  variant = "unified",
}: AddDocumentDropdownProps) {
  const { isFree, isTrial } = usePlan();
  const { canAddDocuments } = useLimits();
  const { uploadTriggers } = useUploadProgress();

  const [menuOpen, setMenuOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [importFoldersOpen, setImportFoldersOpen] = useState(false);
  const [docModal, setDocModal] = useState<DocModalState>({
    open: false,
    defaultTab: "document",
    defaultUploadMode: "file",
  });
  const [upgradeModal, setUpgradeModal] = useState<{
    open: boolean;
    trigger: string;
    highlight: string[];
  }>({ open: false, trigger: "", highlight: [] });

  const requiresUpgradeForFolders = isFree && !isTrial;
  const requiresUpgradeForWebLink = isFree && !isTrial;

  const enforceDocumentLimit = useCallback((): boolean => {
    // Paused subscriptions still surface a toast via AddDocumentModal /
    // UploadZone, so we only handle the plan-limit gate here.
    if (!canAddDocuments) {
      setUpgradeModal({
        open: true,
        trigger: "limit_upload_documents",
        highlight: ["documents"],
      });
      return false;
    }
    return true;
  }, [canAddDocuments]);

  const handleCreateFolder = useCallback(() => {
    if (requiresUpgradeForFolders) {
      setUpgradeModal({
        open: true,
        trigger: "add_folder_button",
        highlight: ["folder", "folder-sharing", "datarooms"],
      });
      return;
    }
    setFolderOpen(true);
  }, [requiresUpgradeForFolders]);

  const handleImportFolders = useCallback(() => {
    if (requiresUpgradeForFolders) {
      setUpgradeModal({
        open: true,
        trigger: "import_folders_button",
        highlight: ["folder", "folder-sharing", "datarooms"],
      });
      return;
    }
    setImportFoldersOpen(true);
  }, [requiresUpgradeForFolders]);

  const handleUploadFiles = useCallback(() => {
    if (!enforceDocumentLimit()) return;
    if (uploadTriggers) {
      uploadTriggers.openFilesPicker();
      return;
    }
    // No UploadZone is mounted in the visible tree (e.g. while a dataroom
    // search is active and the search-results view replaces the items list).
    // Fall back to the single-file modal so the action isn't a silent no-op.
    setDocModal({
      open: true,
      defaultTab: "document",
      defaultUploadMode: "file",
    });
  }, [enforceDocumentLimit, uploadTriggers]);

  const handleUploadFolder = useCallback(() => {
    if (!enforceDocumentLimit()) return;
    if (uploadTriggers) {
      uploadTriggers.openFolderPicker();
      return;
    }
    // Folder upload requires the directory-mode picker rendered inside
    // UploadZone; no modal fallback exists. Tell the user how to recover
    // (typically: clear the active search) rather than failing silently.
    toast.info("Clear the search to upload a folder here.");
  }, [enforceDocumentLimit, uploadTriggers]);

  const handleAddNotion = useCallback(() => {
    if (!enforceDocumentLimit()) return;
    setDocModal({
      open: true,
      defaultTab: "notion",
      defaultUploadMode: "file",
    });
  }, [enforceDocumentLimit]);

  const handleAddWebLink = useCallback(() => {
    if (requiresUpgradeForWebLink) {
      setUpgradeModal({
        open: true,
        trigger: "add_web_link_document",
        highlight: ["link"],
      });
      return;
    }
    if (!enforceDocumentLimit()) return;
    setDocModal({
      open: true,
      defaultTab: "document",
      defaultUploadMode: "link",
    });
  }, [enforceDocumentLimit, requiresUpgradeForWebLink]);

  // Google Drive-style "N then …" sequences: press N, then F / U / I within
  // the library's default sequence timeout. Plain letters (no ctrl/cmd) keep
  // these clear of every browser-reserved combo while staying discoverable
  // through the menu hints. The shared guard prevents firing while the user
  // is typing in an editable surface.
  const isEditableTarget = useCallback((e: KeyboardEvent): boolean => {
    const target = e.target as HTMLElement | null;
    return !!(
      target &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    );
  }, []);

  const sequenceOptions = useMemo(
    () => ({ preventDefault: false, enableOnFormTags: false as const }),
    [],
  );

  useHotkeys(
    "n>f",
    (e) => {
      if (disabled || isEditableTarget(e)) return;
      e.preventDefault();
      handleCreateFolder();
    },
    sequenceOptions,
    [handleCreateFolder, disabled, isEditableTarget],
  );

  useHotkeys(
    "n>u",
    (e) => {
      if (disabled || isEditableTarget(e)) return;
      e.preventDefault();
      handleUploadFiles();
    },
    sequenceOptions,
    [handleUploadFiles, disabled, isEditableTarget],
  );

  useHotkeys(
    "n>i",
    (e) => {
      if (disabled || isEditableTarget(e)) return;
      e.preventDefault();
      handleUploadFolder();
    },
    sequenceOptions,
    [handleUploadFolder, disabled, isEditableTarget],
  );

  // Memoize so the doc modal doesn't reset itself between renders.
  const docModalKey = useMemo(
    () => `${docModal.defaultTab}-${docModal.defaultUploadMode}`,
    [docModal.defaultTab, docModal.defaultUploadMode],
  );

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        {variant === "split" ? (
          <div className="flex items-center gap-x-2">
            <Button
              size={size}
              disabled={disabled}
              onClick={handleUploadFiles}
              className={cn(
                "flex items-center justify-start gap-x-1 whitespace-nowrap px-2 text-left sm:gap-x-2 sm:px-3",
                className,
              )}
              title="Add document"
            >
              <PlusIcon
                className="h-4 w-4 shrink-0 sm:h-5 sm:w-5"
                aria-hidden="true"
              />
              <span className="text-xs sm:text-sm">
                <span className="hidden sm:inline">Add document</span>
                <span className="sm:hidden">Add</span>
              </span>
            </Button>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size={size}
                disabled={disabled}
                className="group flex items-center gap-x-1 whitespace-nowrap border-gray-500 bg-gray-50 px-2 hover:bg-gray-200 dark:bg-black hover:dark:bg-muted sm:gap-x-2 sm:px-3"
                aria-label="More upload options"
                title="More options"
              >
                <span className="text-xs sm:text-sm">More</span>
                <ChevronDownIcon
                  className="!size-3.5 shrink-0 opacity-80 transition-transform group-data-[state=open]:rotate-180"
                  aria-hidden="true"
                />
              </Button>
            </DropdownMenuTrigger>
          </div>
        ) : (
          <DropdownMenuTrigger asChild>
            <Button
              size={size}
              disabled={disabled}
              className={cn(
                "group flex items-center justify-start gap-x-1 whitespace-nowrap px-2 text-left sm:gap-x-2 sm:px-3",
                className,
              )}
              title="Add"
            >
              <PlusIcon
                className="h-4 w-4 shrink-0 sm:h-5 sm:w-5"
                aria-hidden="true"
              />
              <span className="text-xs sm:text-sm">Add</span>
              <ChevronDownIcon
                // !size overrides the Button cva's `[&_svg]:size-5` rule.
                className="ml-0.5 !size-3.5 shrink-0 opacity-80 transition-transform group-data-[state=open]:rotate-180"
                aria-hidden="true"
              />
            </Button>
          </DropdownMenuTrigger>
        )}
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              handleCreateFolder();
            }}
          >
            <FolderPlusIcon className="h-4 w-4" aria-hidden="true" />
            <span>Create folder</span>
            <DropdownMenuShortcut className="tracking-normal">
              N then F
            </DropdownMenuShortcut>
          </DropdownMenuItem>

          {isDataroom && dataroomId ? (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setMenuOpen(false);
                handleImportFolders();
              }}
            >
              <TablePropertiesIcon
                className="h-4 w-4 -scale-x-100"
                aria-hidden="true"
              />
              <span>Import folders from Excel</span>
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Upload from computer
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              handleUploadFiles();
            }}
          >
            <FileUpIcon className="h-4 w-4" aria-hidden="true" />
            <span>Files</span>
            <DropdownMenuShortcut className="tracking-normal">
              N then U
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              handleUploadFolder();
            }}
          >
            <FolderUpIcon className="h-4 w-4" aria-hidden="true" />
            <span>Folder</span>
            <DropdownMenuShortcut className="tracking-normal">
              N then I
            </DropdownMenuShortcut>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            More options
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              handleAddNotion();
            }}
          >
            <NotionIcon className="h-4 w-4" aria-hidden="true" />
            <span>Add Notion page</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              handleAddWebLink();
            }}
          >
            <LinkIcon className="h-4 w-4" aria-hidden="true" />
            <span>Add web link</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AddFolderModal
        open={folderOpen}
        onOpenChange={setFolderOpen}
        isDataroom={isDataroom}
        dataroomId={dataroomId}
      />

      {isDataroom && dataroomId ? (
        <ImportFoldersModal
          open={importFoldersOpen}
          setOpen={setImportFoldersOpen}
          dataroomId={dataroomId}
        />
      ) : null}

      <AddDocumentModal
        key={docModalKey}
        openModal={docModal.open}
        setAddDocumentModalOpen={(open) =>
          setDocModal((prev) => ({ ...prev, open }))
        }
        defaultTab={docModal.defaultTab}
        defaultUploadMode={docModal.defaultUploadMode}
        isDataroom={isDataroom}
        dataroomId={dataroomId}
      />

      <UpgradePlanModal
        clickedPlan={PlanEnum.Pro}
        trigger={upgradeModal.trigger}
        highlightItem={upgradeModal.highlight}
        open={upgradeModal.open}
        setOpen={(open) =>
          setUpgradeModal((prev) => ({
            ...prev,
            open: typeof open === "function" ? open(prev.open) : open,
          }))
        }
      />
    </>
  );
}
