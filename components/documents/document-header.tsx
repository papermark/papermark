import Link from "next/link";
import { useRouter } from "next/router";

import { useEffect, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import { DocumentAIDialog } from "@/ee/features/ai/components/document-ai-dialog";
import { PlanEnum } from "@/ee/stripe/constants";
import { Document, DocumentVersion } from "@prisma/client";
import {
  ArrowRightIcon,
  BetweenHorizontalStartIcon,
  ChevronRight,
  CloudDownloadIcon,
  DownloadIcon,
  FileDownIcon,
  FolderIcon,
  MoonIcon,
  ServerIcon,
  SheetIcon,
  SunIcon,
  TrashIcon,
  ViewIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { mutate } from "swr";

import { getFile } from "@/lib/files/get-file";
import { usePlan } from "@/lib/swr/use-billing";
import useDataroomsSimple from "@/lib/swr/use-datarooms-simple";
import { useTeamAI } from "@/lib/swr/use-team-ai";
import {
  DocumentWithLinksAndLinkCountAndViewCount,
  DocumentWithVersion,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { supportsAdvancedExcelMode } from "@/lib/utils/get-content-type";
import { fileIcon } from "@/lib/utils/get-file-icon";

import FileUp from "@/components/shared/icons/file-up";
import MoreVertical from "@/components/shared/icons/more-vertical";
import PapermarkSparkle from "@/components/shared/icons/papermark-sparkle";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import PlanBadge from "../billing/plan-badge";
import { UpgradePlanModal } from "../billing/upgrade-plan-modal";
import AdvancedSheet from "../shared/icons/advanced-sheet";
import PortraitLandscape from "../shared/icons/portrait-landscape";
import LoadingSpinner from "../ui/loading-spinner";
import { ButtonTooltip } from "../ui/tooltip";
import { AddDocumentModal } from "./add-document-modal";
import { AddToDataroomModal } from "./add-document-to-dataroom-modal";
import AlertBanner from "./alert";
import { ExportVisitsModal } from "./export-visits-modal";

export default function DocumentHeader({
  prismaDocument,
  primaryVersion,
  teamId,
  actions,
}: {
  prismaDocument: DocumentWithVersion;
  primaryVersion: DocumentVersion;
  teamId: string;
  actions?: React.ReactNode[];
}) {
  const router = useRouter();
  const teamInfo = useTeam();
  const { datarooms } = useDataroomsSimple();
  const { theme, systemTheme } = useTheme();
  const isLight =
    theme === "light" || (theme === "system" && systemTheme === "light");
  const { isPro, isFree, isTrial, isBusiness, isDatarooms } = usePlan();
  const { canUseAI, isAIEnabled } = useTeamAI();
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [isFirstClick, setIsFirstClick] = useState<boolean>(false);
  const [orientationLoading, setOrientationLoading] = useState<boolean>(false);
  const [addDataRoomOpen, setAddDataRoomOpen] = useState<boolean>(false);
  const [addDocumentVersion, setAddDocumentVersion] = useState<boolean>(false);
  const [openAddDocModal, setOpenAddDocModal] = useState<boolean>(false);
  const [planModalOpen, setPlanModalOpen] = useState<boolean>(false);
  const [planModalTrigger, setPlanModalTrigger] = useState<string>("");
  const [selectedPlan, setSelectedPlan] = useState<PlanEnum>(PlanEnum.Pro);
  const [exportModalOpen, setExportModalOpen] = useState<boolean>(false);
  const [aiDialogOpen, setAiDialogOpen] = useState<boolean>(false);
  const nameRef = useRef<HTMLHeadingElement>(null);
  const enterPressedRef = useRef<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const actionRows: React.ReactNode[][] = [];

  if (actions) {
    for (let i = 0; i < actions.length; i += 3) {
      actionRows.push(actions.slice(i, i + 3));
    }
  }

  // Check if document is in any datarooms
  const dataroomCount = prismaDocument.datarooms?.length || 0;

  const handleUpgradeClick = (plan: PlanEnum, trigger: string) => {
    setSelectedPlan(plan);
    setPlanModalTrigger(trigger);
    setPlanModalOpen(true);
  };

  const handleCloseAlert = (id: string) => {
    const alert = document.getElementById(id);
    if (alert) {
      alert.style.display = "none";
    }
  };

  const currentTime = new Date();
  const formattedTime =
    currentTime.getFullYear() +
    "-" +
    String(currentTime.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(currentTime.getDate()).padStart(2, "0") +
    "_" +
    String(currentTime.getHours()).padStart(2, "0") +
    "-" +
    String(currentTime.getMinutes()).padStart(2, "0");
  "-" + String(currentTime.getSeconds()).padStart(2, "0");

  // https://github.com/radix-ui/primitives/issues/1241#issuecomment-1888232392
  useEffect(() => {
    if (!addDataRoomOpen || !addDocumentVersion) {
      setTimeout(() => {
        document.body.style.pointerEvents = "";
      });
    }
  }, [addDataRoomOpen, addDocumentVersion]);

  const handleNameSubmit = async () => {
    if (enterPressedRef.current) {
      enterPressedRef.current = false;
      return;
    }
    if (nameRef.current && isEditingName) {
      const newName = nameRef.current.innerText;

      if (newName !== prismaDocument!.name) {
        const response = await fetch(
          `/api/teams/${teamId}/documents/${prismaDocument!.id}/update-name`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: newName,
            }),
          },
        );

        if (response.ok) {
          const { message } = await response.json();
          toast.success(message);
        } else {
          const { message } = await response.json();
          toast.error(message);
        }
      }
      setIsEditingName(false);
    }
  };

  const preventEnterAndSubmit = (
    event: React.KeyboardEvent<HTMLHeadingElement>,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault(); // Prevent the default line break
      setIsEditingName(true);
      enterPressedRef.current = true;
      handleNameSubmit(); // Handle the submit
      if (nameRef.current) {
        nameRef.current.blur(); // Remove focus from the h2 element
      }
    }
  };

  const [enablingAI, setEnablingAI] = useState<boolean>(false);

  // Enable AI agents and automatically index the document
  const enableAIAgents = async () => {
    if (!canUseAI) {
      toast.error(
        "AI agents are not available. Please enable them in team settings first.",
      );
      return;
    }

    setEnablingAI(true);

    try {
      // Step 1: Enable AI agents on the document
      const enableResponse = await fetch(
        `/api/teams/${teamId}/documents/${prismaDocument.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ agentsEnabled: true }),
        },
      );

      if (!enableResponse.ok) {
        throw new Error("Failed to enable AI agents");
      }

      // Step 2: Index the document automatically
      const indexResponse = await fetch(
        `/api/ai/store/teams/${teamId}/documents/${prismaDocument.id}`,
        {
          method: "POST",
        },
      );

      if (!indexResponse.ok) {
        // If indexing fails, still keep AI enabled but show warning
        let errorMessage =
          "AI enabled, but document indexing failed. You can re-index from settings.";
        try {
          const error = await indexResponse.json();
          if (error.error) {
            errorMessage = error.error;
          }
        } catch {
          // JSON parsing failed, try to get raw text
          try {
            const text = await indexResponse.text();
            if (text) {
              errorMessage = text;
            }
          } catch {
            // Ignore text parsing errors, use default message
          }
        }
        toast.warning(errorMessage);
      } else {
        toast.success("AI agents enabled and document indexed successfully");
      }

      // Refresh document data
      mutate(`/api/teams/${teamId}/documents/${prismaDocument.id}`);
    } catch (error) {
      console.error("Error enabling AI agents:", error);
      toast.error("Failed to enable AI agents. Please try again.");
    } finally {
      setEnablingAI(false);
    }
  };

  const changeDocumentOrientation = async () => {
    setOrientationLoading(true);
    try {
      const response = await fetch(
        "/api/teams/" +
          teamId +
          "/documents/" +
          prismaDocument.id +
          "/change-orientation",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            versionId: primaryVersion.id,
            isVertical: primaryVersion.isVertical ? false : true,
          }),
        },
      );

      if (response.ok) {
        const { message } = await response.json();
        toast.success(message);

        mutate(`/api/teams/${teamId}/documents/${prismaDocument.id}`);
      } else {
        const { message } = await response.json();
        toast.error(message);
      }
    } catch (error) {
      console.error("Error:", error);
      toast.error("An error occurred. Please try again.");
    } finally {
      setOrientationLoading(false);
    }
  };

  const toggleAdvancedExcel = async (document: Document, enabled: boolean) => {
    toast.promise(
      fetch(`/api/teams/${teamId}/documents/${document.id}/advanced-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }).then(async (response) => {
        if (!response.ok) {
          const { message } = await response.json();
          throw new Error(message);
        }
        const { message } = await response.json();
        mutate(`/api/teams/${teamId}/documents/${document.id}`);
        if (enabled) {
          handleCloseAlert("enable-advanced-excel-alert");
        }
        return message;
      }),
      {
        loading: enabled
          ? "Enabling advanced Excel mode..."
          : "Disabling advanced Excel mode...",
        success: (message) => message,
        error: (error) =>
          error.message ||
          (enabled
            ? "Failed to enable advanced Excel mode"
            : "Failed to disable advanced Excel mode"),
      },
    );
  };

  // export method to fetch the visits data and convert to csv.
  const exportVisitCounts = (document: Document) => {
    if (isFree) {
      toast.error("This feature is not available for your plan");
      return;
    }
    setExportModalOpen(true);
  };

  // Make a document download only or viewable
  const toggleDownloadOnly = async () => {
    toast.promise(
      fetch(
        `/api/teams/${teamId}/documents/${prismaDocument.id}/toggle-download-only`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            downloadOnly: !prismaDocument.downloadOnly,
          }),
        },
      ).then(() => {
        mutate(`/api/teams/${teamId}/documents/${prismaDocument.id}`);
      }),
      {
        loading: "Updating document...",
        success: `Document is now ${
          !prismaDocument.downloadOnly ? "download only" : "viewable"
        }`,
        error: "Failed to update document",
      },
    );
  };

  // Toggle dark mode for Notion documents
  const toggleNotionDarkMode = async (darkMode: boolean) => {
    if (prismaDocument.type !== "notion") {
      toast.error("This feature is not available for your document type");
      return;
    }

    toast.promise(
      fetch(
        `/api/teams/${teamId}/documents/${prismaDocument.id}/toggle-dark-mode`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            darkMode: darkMode,
          }),
        },
      ).then(() => {
        mutate(`/api/teams/${teamId}/documents/${prismaDocument.id}`);
      }),
      {
        loading: "Updating Notion theme...",
        success: `Notion theme changed to ${darkMode ? "dark" : "light"} mode`,
        error: "Failed to update Notion theme",
      },
    );
  };

  useEffect(() => {
    function handleClickOutside(event: { target: any }) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setMenuOpen(false);
        setIsFirstClick(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleDeleteDocument = async (documentId: string) => {
    // Prevent the first click from deleting the document
    if (!isFirstClick) {
      setIsFirstClick(true);
      return;
    }

    toast.promise(
      fetch(`/api/teams/${teamId}/documents/${documentId}`, {
        method: "DELETE",
      }).then(async (res) => {
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to delete document");
        }
        mutate(`/api/teams/${teamInfo?.currentTeam?.id}/documents`, null, {
          populateCache: (_, docs) => {
            return docs.filter(
              (doc: DocumentWithLinksAndLinkCountAndViewCount) =>
                doc.id !== documentId,
            );
          },
          revalidate: false,
        });
        setIsFirstClick(false);
        setMenuOpen(false);
        router.push("/documents");
      }),
      {
        loading: "Deleting document...",
        success: "Document deleted successfully.",
        error: (err) => err.message || "Failed to delete document. Try again.",
      },
    );
  };

  const handleMenuStateChange = (open: boolean) => {
    if (isFirstClick) {
      setMenuOpen(true); // Keep the dropdown open on the first click
      return;
    }

    // If the menu is closed, reset the isFirstClick state
    if (!open) {
      setIsFirstClick(false);
      setMenuOpen(false); // Ensure the dropdown is closed
    } else {
      setMenuOpen(true); // Open the dropdown
    }
  };

  const handleButtonClick = (event: any, documentId: string) => {
    event.stopPropagation();
    event.preventDefault();

    if (isFirstClick) {
      handleDeleteDocument(documentId);
      setIsFirstClick(false);
      setMenuOpen(false); // Close the dropdown after deleting
    } else {
      setIsFirstClick(true);
    }
  };

  const downloadDocument = async (documentVersion: DocumentVersion) => {
    if (documentVersion.type === "notion") {
      toast.error("Notion documents cannot be downloaded.");
      return;
    }
    toast.promise(
      (async () => {
        const downloadUrl = await getFile({
          type: documentVersion.storageType,
          data: documentVersion.originalFile ?? documentVersion.file,
          isDownload: true,
        });

        // Fetch the file from the S3 URL and create blob
        const response = await fetch(downloadUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = prismaDocument.name;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      })(),
      {
        loading: "Downloading document...",
        success: "Document downloaded successfully",
        error: "Failed to download document",
      },
    );
  };

  return (
    <header className="flex flex-col gap-y-4">
      <div className="flex items-center justify-between gap-x-2 sm:gap-x-8">
        <div className="flex min-w-0 items-center space-x-2">
          {fileIcon({
            fileType: prismaDocument.type ?? "",
            className: "size-7 shrink-0 sm:size-8",
            isLight,
          })}

          <div className="mt-1 flex min-w-0 flex-col lg:mt-0">
            <h2
              className="truncate rounded-md border border-transparent px-1 py-0.5 text-base font-semibold tracking-tight text-foreground duration-200 hover:cursor-text hover:border hover:border-border focus-visible:text-base sm:text-lg sm:focus-visible:text-lg lg:px-3 lg:py-1 lg:text-xl lg:focus-visible:text-xl xl:text-2xl"
              ref={nameRef}
              contentEditable={true}
              onFocus={() => setIsEditingName(true)}
              onBlur={handleNameSubmit}
              onKeyDown={preventEnterAndSubmit}
              title="Click to edit"
              dangerouslySetInnerHTML={{ __html: prismaDocument.name }}
            />
            {isEditingName && (
              <span className="mt-1 text-xs text-muted-foreground">
                {`Press <Enter> to save the name.`}
              </span>
            )}
          </div>

          {prismaDocument.type === "sheet" &&
            prismaDocument.advancedExcelEnabled && (
              <ButtonTooltip content="Advanced Excel mode">
                <span className="mt-1 text-xs">
                  <AdvancedSheet className="h-6 w-6" />
                </span>
              </ButtonTooltip>
            )}

          {prismaDocument.downloadOnly && (
            <ButtonTooltip content="Download only">
              <span className="text-xs">
                <CloudDownloadIcon className="h-6 w-6" />
                <span className="sr-only">This document is download only</span>
              </span>
            </ButtonTooltip>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-x-1 sm:gap-x-4 md:gap-x-2">
          {primaryVersion.type !== "notion" &&
            primaryVersion.type !== "link" &&
            primaryVersion.type !== "sheet" &&
            primaryVersion.type !== "zip" &&
            primaryVersion.type !== "video" &&
            (!orientationLoading ? (
              <ButtonTooltip content="Change orientation">
                <Button
                  variant="outline"
                  size="icon"
                  className="hidden size-8 sm:flex lg:size-9"
                  onClick={changeDocumentOrientation}
                  title={`Change document orientation to ${primaryVersion.isVertical ? "landscape" : "portrait"}`}
                >
                  <PortraitLandscape
                    className={cn(
                      "h-6 w-6",
                      !primaryVersion.isVertical && "-rotate-90 transform",
                    )}
                  />
                </Button>
              </ButtonTooltip>
            ) : (
              <div className="hidden md:flex">
                <LoadingSpinner className="h-6 w-6" />
              </div>
            ))}

          {primaryVersion.type !== "notion" &&
            primaryVersion.type !== "link" && (
              <AddDocumentModal
                newVersion
                openModal={openAddDocModal}
                setAddDocumentModalOpen={setOpenAddDocModal}
              >
                <ButtonTooltip content="Upload new version">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenAddDocModal(true);
                    }}
                    className="hidden size-8 md:flex lg:size-9"
                  >
                    <FileUp className="h-6 w-6" />
                  </Button>
                </ButtonTooltip>
              </AddDocumentModal>
            )}

          {/* AI Agents Button */}
          {isAIEnabled &&
            prismaDocument.type !== "notion" &&
            primaryVersion.type !== "link" &&
            prismaDocument.type !== "zip" &&
            primaryVersion.type !== "video" &&
            (prismaDocument.agentsEnabled ? (
              <ButtonTooltip content="AI Agents Settings">
                <Button
                  variant="outline"
                  size="icon"
                  className="hidden size-8 md:flex lg:size-9"
                  onClick={() => setAiDialogOpen(true)}
                >
                  <PapermarkSparkle className="h-5 w-5 text-emerald-500" />
                </Button>
              </ButtonTooltip>
            ) : (
              <ButtonTooltip content="Enable AI Agents">
                <Button
                  variant="outline"
                  size="icon"
                  className="hidden size-8 md:flex lg:size-9"
                  onClick={enableAIAgents}
                  disabled={enablingAI}
                >
                  {enablingAI ? (
                    <LoadingSpinner className="h-5 w-5" />
                  ) : (
                    <PapermarkSparkle className="h-5 w-5" />
                  )}
                </Button>
              </ButtonTooltip>
            ))}

          <div className="flex items-center gap-x-1">
            {actionRows.map((row, i) => (
              <ul
                key={i.toString()}
                className="flex flex-wrap items-center justify-end gap-x-2 md:flex-nowrap md:gap-x-1"
              >
                {row.map((action, i) => (
                  <li key={i}>{action}</li>
                ))}
              </ul>
            ))}
          </div>

          <DropdownMenu open={menuOpen} onOpenChange={handleMenuStateChange}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-8 w-8 bg-transparent p-0 lg:h-9 lg:w-9"
              >
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-[240px]"
              ref={dropdownRef}
            >
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuGroup className="block md:hidden">
                {prismaDocument.type !== "notion" &&
                  primaryVersion.type !== "video" && (
                    <DropdownMenuItem>
                      <AddDocumentModal
                        newVersion
                        setAddDocumentModalOpen={setAddDocumentVersion}
                      >
                        <button
                          title="Add a new version"
                          className="flex items-center"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddDocumentVersion(true);
                          }}
                        >
                          <FileUp className="mr-2 h-4 w-4" /> Add new version
                        </button>
                      </AddDocumentModal>
                    </DropdownMenuItem>
                  )}

                <DropdownMenuSeparator />
              </DropdownMenuGroup>
              {prismaDocument.type === "sheet" &&
                supportsAdvancedExcelMode(primaryVersion.contentType) &&
                (isPro || isBusiness || isDatarooms || isTrial) && (
                  <DropdownMenuItem
                    onClick={() =>
                      toggleAdvancedExcel(
                        prismaDocument,
                        !prismaDocument.advancedExcelEnabled,
                      )
                    }
                  >
                    <SheetIcon className="mr-2 h-4 w-4" />
                    {prismaDocument.advancedExcelEnabled
                      ? "Disable Advanced Mode"
                      : "Enable Advanced Mode"}
                  </DropdownMenuItem>
                )}
              {datarooms && datarooms.length !== 0 && (
                <DropdownMenuItem onClick={() => setAddDataRoomOpen(true)}>
                  <BetweenHorizontalStartIcon className="mr-2 h-4 w-4" />
                  Add to dataroom
                </DropdownMenuItem>
              )}

              {/* AI Agents - only show when team has AI enabled */}
              {isAIEnabled &&
                prismaDocument.type !== "notion" &&
                primaryVersion.type !== "link" &&
                prismaDocument.type !== "zip" &&
                primaryVersion.type !== "video" &&
                (prismaDocument.agentsEnabled ? (
                  <DropdownMenuItem
                    onClick={() => {
                      setAiDialogOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    <PapermarkSparkle className="mr-2 h-4 w-4 text-emerald-500" />
                    AI Agents Settings
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() => {
                      enableAIAgents();
                      setMenuOpen(false);
                    }}
                    disabled={enablingAI}
                  >
                    <PapermarkSparkle className="mr-2 h-4 w-4" />
                    {enablingAI ? "Enabling AI..." : "Enable AI Agents"}
                  </DropdownMenuItem>
                ))}

              {primaryVersion.type !== "notion" &&
                primaryVersion.type !== "link" &&
                primaryVersion.type !== "zip" &&
                primaryVersion.type !== "map" &&
                primaryVersion.type !== "email" && (
                  <DropdownMenuItem
                    onClick={() =>
                      isFree
                        ? handleUpgradeClick(
                            PlanEnum.Business,
                            "download-only-document",
                          )
                        : toggleDownloadOnly()
                    }
                  >
                    {prismaDocument.downloadOnly ? (
                      <>
                        <ViewIcon className="mr-2 h-4 w-4" />
                        Set viewable
                      </>
                    ) : (
                      <>
                        <CloudDownloadIcon className="mr-2 h-4 w-4" />
                        Set download only{" "}
                        {isFree && <PlanBadge className="ml-2" plan="pro" />}
                      </>
                    )}
                  </DropdownMenuItem>
                )}

              {prismaDocument.type === "notion" && (
                <>
                  {primaryVersion.file.includes("mode=dark") ? (
                    <DropdownMenuItem
                      onClick={() => toggleNotionDarkMode(false)}
                    >
                      <MoonIcon className="mr-2 h-4 w-4" />
                      Disable dark mode
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => toggleNotionDarkMode(true)}
                    >
                      <SunIcon className="mr-2 h-4 w-4" />
                      Enable dark mode
                    </DropdownMenuItem>
                  )}
                </>
              )}

              <DropdownMenuSeparator />

              {/* Export views in CSV */}
              <DropdownMenuItem
                onClick={() =>
                  isFree
                    ? handleUpgradeClick(PlanEnum.Pro, "export-document-visits")
                    : exportVisitCounts(prismaDocument)
                }
              >
                <FileDownIcon className="mr-2 h-4 w-4" />
                Export views{" "}
                {isFree && <PlanBadge className="ml-2" plan="pro" />}
              </DropdownMenuItem>

              {/* Download latest version */}
              {primaryVersion.type !== "notion" &&
                primaryVersion.type !== "link" &&
                primaryVersion.type !== "video" && (
                  <DropdownMenuItem
                    onClick={() => downloadDocument(primaryVersion)}
                  >
                    <DownloadIcon className="mr-2 h-4 w-4" />
                    Download latest version
                  </DropdownMenuItem>
                )}

              <DropdownMenuSeparator />

              <DropdownMenuItem
                className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
                onClick={(event) => handleButtonClick(event, prismaDocument.id)}
              >
                <TrashIcon className="mr-2 h-4 w-4" />
                {isFirstClick ? "Really delete?" : "Delete document"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Datarooms collapsible section */}
      {dataroomCount > 0 && (
        <div className="mb-2">
          <Collapsible className="w-full">
            <CollapsibleTrigger className="flex w-full items-center text-sm font-medium">
              <div className="flex items-center space-x-2 [&[data-state=open]>svg.chevron]:rotate-180">
                <ChevronRight className="h-4 w-4 transition-transform duration-200" />
                <ServerIcon className="h-4 w-4 text-[#fb7a00]" />
                <span>
                  In {dataroomCount} dataroom{dataroomCount > 1 ? "s" : ""}
                </span>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="pl-6 pt-2">
              <ul className="space-y-1">
                {prismaDocument.datarooms?.map((item) => (
                  <li
                    key={item.dataroom.id}
                    className="flex items-center space-x-2 text-sm"
                  >
                    <ArrowRightIcon className="h-3.5 w-3.5" />
                    <Link
                      href={`/datarooms/${item.dataroom.id}/documents`}
                      className="hover:underline"
                    >
                      {item.dataroom.name}
                    </Link>
                    {item.folder ? (
                      <Link
                        href={`/datarooms/${item.dataroom.id}/documents/${item.folder.path}`}
                        className="flex flex-row items-center space-x-2 hover:underline"
                        title={`Folder: ${item.folder.name}`}
                      >
                        <ArrowRightIcon className="h-3.5 w-3.5" />
                        <FolderIcon className="mr-1 h-4 w-4" />
                        <span className="ml-1 truncate">
                          {item.folder.name}
                        </span>
                      </Link>
                    ) : (
                      <Link
                        href={`/datarooms/${item.dataroom.id}/documents`}
                        className="flex flex-row items-center space-x-2 hover:underline"
                        title="Home"
                      >
                        <ArrowRightIcon className="h-3.5 w-3.5" />
                        <FolderIcon className="mr-1 h-4 w-4" />
                        <span className="ml-1 truncate">Home</span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {isFree && prismaDocument.hasPageLinks && (
        <AlertBanner
          id="in-document-links-alert"
          variant="destructive"
          title="In-document links detected"
          description={
            <>
              External in-document links are not available on the free plan.{" "}
              <span
                className="cursor-pointer underline underline-offset-4 hover:text-destructive/80"
                onClick={() =>
                  handleUpgradeClick(PlanEnum.Pro, "in-document-links")
                }
              >
                Upgrade
              </span>{" "}
              to a higher plan to use this feature.
            </>
          }
          onClose={() => handleCloseAlert("in-document-links-alert")}
        />
      )}

      {prismaDocument.type === "sheet" &&
        supportsAdvancedExcelMode(primaryVersion.contentType) &&
        isFree &&
        !isTrial && (
          <AlertBanner
            id="advanced-excel-alert"
            variant="default"
            title="Advanced Excel mode"
            description={
              <>
                You can turn on advanced excel mode by{" "}
                <span
                  className="hover:text-primary/ 80 cursor-pointer underline underline-offset-4"
                  onClick={() =>
                    handleUpgradeClick(PlanEnum.Pro, "advanced-excel-mode")
                  }
                >
                  upgrading
                </span>{" "}
                to Pro plan to preserve the file formatting. This uses the
                Microsoft Office viewer.
              </>
            }
            onClose={() => handleCloseAlert("advanced-excel-alert")}
          />
        )}

      {prismaDocument.type === "sheet" &&
        !prismaDocument.advancedExcelEnabled &&
        supportsAdvancedExcelMode(primaryVersion.contentType) &&
        (isPro || isBusiness || isDatarooms || isTrial) && (
          <AlertBanner
            id="enable-advanced-excel-alert"
            variant="default"
            title="Advanced Excel mode"
            description={
              <>
                You can{" "}
                <span
                  className="cursor-pointer underline underline-offset-4 hover:text-primary/80"
                  onClick={() => setMenuOpen(true)}
                >
                  turn on
                </span>{" "}
                advanced excel mode to improve the file formatting.
                <br /> The advanced mode uses Microsoft viewer.
              </>
            }
            onClose={() => handleCloseAlert("enable-advanced-excel-alert")}
          />
        )}

      {addDataRoomOpen ? (
        <AddToDataroomModal
          open={addDataRoomOpen}
          setOpen={setAddDataRoomOpen}
          documentId={prismaDocument.id}
          documentName={prismaDocument.name}
        />
      ) : null}

      {planModalOpen ? (
        <UpgradePlanModal
          clickedPlan={selectedPlan}
          trigger={planModalTrigger}
          open={planModalOpen}
          setOpen={setPlanModalOpen}
        />
      ) : null}

      {exportModalOpen && (
        <ExportVisitsModal
          document={prismaDocument}
          teamId={teamId}
          onClose={() => setExportModalOpen(false)}
        />
      )}

      {/* AI Agents Dialog */}
      <DocumentAIDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        documentId={prismaDocument.id}
        teamId={teamId}
        agentsEnabled={prismaDocument.agentsEnabled}
        vectorStoreFileId={primaryVersion.vectorStoreFileId}
      />
    </header>
  );
}
