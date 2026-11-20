import Link from "next/link";
import { useRouter } from "next/router";

import { FormEvent, useEffect, useState } from "react";

import { useTeam } from "@/context/team-context";
import { useUploadProgress } from "@/context/upload-progress-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { DefaultPermissionStrategy } from "@prisma/client";
import { parsePageId } from "notion-utils";
import { toast } from "sonner";
import { mutate } from "swr";
import { z } from "zod";

import { useAnalytics } from "@/lib/analytics";
import {
  DocumentData,
  createDocument,
  createNewDocumentVersion,
} from "@/lib/documents/create-document";
import { putFile } from "@/lib/files/put-file";
import { useDataroomPermissions } from "@/lib/hooks/use-dataroom-permissions";
import { getNotionPageIdFromSlug } from "@/lib/notion/utils";
import { usePlan } from "@/lib/swr/use-billing";
import { useDataroom } from "@/lib/swr/use-dataroom";
import useLimits from "@/lib/swr/use-limits";
import {
  getSupportedContentType,
  isHtmlFile,
} from "@/lib/utils/get-content-type";

import { SetUnifiedPermissionsModal } from "@/components/datarooms/groups/set-unified-permissions-modal";
import DocumentUpload from "@/components/document-upload";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { UpgradePlanModal } from "../billing/upgrade-plan-modal";

interface DataroomDocument {
  id: string;
  documentId: string;
  dataroomId: string;
}

export function AddDocumentModal({
  newVersion,
  children,
  isDataroom,
  dataroomId,
  documentId: documentIdProp,
  setAddDocumentModalOpen,
  openModal,
  defaultTab = "document",
  defaultUploadMode = "file",
}: {
  newVersion?: boolean;
  children?: React.ReactNode;
  isDataroom?: boolean;
  openModal?: boolean;
  dataroomId?: string;
  /**
   * Explicit document id to upload a new version against. Required on routes
   * where `router.query.id` is not the document id (e.g. the dataroom document
   * view at `/datarooms/[id]/document/[documentId]`, where it is the dataroom
   * id). Falls back to `router.query.id` when omitted.
   */
  documentId?: string;
  setAddDocumentModalOpen?: (isOpen: boolean) => void;
  /** Initial tab shown when the modal opens. */
  defaultTab?: "document" | "notion";
  /** Initial upload mode within the Document tab (file picker vs. web link). */
  defaultUploadMode?: "file" | "link";
}) {
  const router = useRouter();
  const analytics = useAnalytics();
  const [uploading, setUploading] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean | undefined>(undefined);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [notionLink, setNotionLink] = useState<string | null>(null);
  const [webLink, setWebLink] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"document" | "notion">(
    defaultTab,
  );
  const [uploadMode, setUploadMode] = useState<"file" | "link">(
    defaultUploadMode,
  );
  const [showGroupPermissions, setShowGroupPermissions] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<
    {
      documentId: string;
      dataroomDocumentId: string;
      fileName: string;
    }[]
  >([]);
  const teamInfo = useTeam();
  const { canAddDocuments, limits } = useLimits();
  const { plan, isFree, isTrial, isPaused } = usePlan();
  const { dataroom } = useDataroom();
  const { uploadTriggers } = useUploadProgress();
  const teamId = teamInfo?.currentTeam?.id as string;

  const { applyPermissions } = useDataroomPermissions();

  useEffect(() => {
    if (openModal) {
      setIsOpen(true);
      // Reset to the caller-requested starting state every time we open the
      // modal programmatically so e.g. clicking "Notion" in the +Add menu
      // never lands on a stale "link" upload form left over from last time.
      setActiveTab(defaultTab);
      setUploadMode(defaultUploadMode);
    }
  }, [openModal, defaultTab, defaultUploadMode]);

  /** current folder name */
  const currentFolderPath = router.query.name as string[] | undefined;

  const addDocumentToDataroom = async ({
    documentId,
    folderPathName,
  }: {
    documentId: string;
    folderPathName?: string;
  }): Promise<Response | undefined> => {
    try {
      const response = await fetch(
        `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/documents`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            documentId: documentId,
            folderPathName: folderPathName,
          }),
        },
      );

      if (!response.ok) {
        const { message } = await response.json();
        toast.error(message);
        return undefined;
      }

      mutate(
        `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/documents`,
      );
      mutate(
        `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/${dataroomId}/folder-documents/${folderPathName}`,
      );

      toast.success("Document added to dataroom successfully! 🎉");
      return response;
    } catch (error) {
      toast.error("Error adding document to dataroom.");
      console.error(
        "An error occurred while adding document to the dataroom: ",
        error,
      );
      return undefined;
    }
  };

  const toastErrorMessage = () =>
    toast.error(
      "Failed to apply default permissions. Update the group permissions in the group settings.",
    );

  const applyUnifiedPermissionsToDocument = async (
    document: any,
    dataroomDocument: DataroomDocument & {
      dataroom: {
        _count: { viewerGroups: number; permissionGroups: number };
      };
    },
    currentFolderPath?: string[],
  ): Promise<void> => {
    const hasAnyGroups =
      dataroomDocument.dataroom._count.viewerGroups > 0 ||
      dataroomDocument.dataroom._count.permissionGroups > 0;

    if (!hasAnyGroups) return;

    const groupStrategy =
      dataroom?.defaultGroupPermissionStrategy ||
      DefaultPermissionStrategy.INHERIT_FROM_PARENT;
    const linkStrategy =
      dataroom?.defaultPermissionStrategy ||
      DefaultPermissionStrategy.INHERIT_FROM_PARENT;

    // If either side wants to ask, surface the unified modal so the user can
    // configure group and/or link permissions in one place.
    const shouldAsk =
      groupStrategy === DefaultPermissionStrategy.ASK_EVERY_TIME ||
      linkStrategy === DefaultPermissionStrategy.ASK_EVERY_TIME;

    if (shouldAsk) {
      setShowGroupPermissions(true);
      setUploadedFiles([
        {
          documentId: document.id,
          dataroomDocumentId: dataroomDocument.id,
          fileName: document.name,
        },
      ]);
      return;
    }

    // No interactive prompt needed — defer to the server, which will apply
    // each strategy independently to viewer groups vs. permission groups.
    // HIDDEN_BY_DEFAULT for both sides becomes a no-op server-side, so we can
    // skip the round-trip entirely in that case.
    if (
      groupStrategy === DefaultPermissionStrategy.HIDDEN_BY_DEFAULT &&
      linkStrategy === DefaultPermissionStrategy.HIDDEN_BY_DEFAULT
    ) {
      return;
    }

    const isRootLevel = !currentFolderPath || currentFolderPath.length === 0;

    try {
      const result = await applyPermissions(
        dataroomId!,
        [document.id],
        { groupStrategy, linkStrategy },
        isRootLevel ? undefined : currentFolderPath?.join("/"),
        toastErrorMessage,
      );

      if (!result.success) {
        console.error("Failed to apply permissions:", result.error);
        toastErrorMessage();
      }
    } catch (error) {
      console.error("Failed to apply permissions:", error);
      toastErrorMessage();
    }
  };

  const handleFileUpload = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();

    // Check if team is paused
    if (isPaused) {
      toast.error(
        "Your subscription is paused. Resume your subscription to upload documents.",
        {
          action: {
            label: "Go to Billing",
            onClick: () => router.push("/settings/billing"),
          },
        },
      );
      return;
    }

    // Check if the file is chosen
    if (!currentFile) {
      toast.error("Please select a file to upload.");
      return; // prevent form from submitting
    }

    if (!canAddDocuments) {
      toast.error(
        limits?.documents
          ? `You've reached your plan's document limit (${limits.usage?.documents}/${limits.documents} documents). Upgrade your plan to upload more.`
          : "You have reached the maximum number of documents.",
        {
          action: {
            label: "Upgrade",
            onClick: () => router.push("/settings/billing"),
          },
          duration: 8000,
        },
      );
      return;
    }

    try {
      setUploading(true);

      let contentType = currentFile.type;
      let supportedFileType = getSupportedContentType(contentType);

      if (
        currentFile.name.endsWith(".dwg") ||
        currentFile.name.endsWith(".dxf")
      ) {
        supportedFileType = "cad";
        contentType = `image/vnd.${currentFile.name.split(".").pop()}`;
      }

      if (currentFile.name.endsWith(".xlsm")) {
        supportedFileType = "sheet";
        contentType = "application/vnd.ms-excel.sheet.macroEnabled.12";
      }

      if (
        currentFile.name.endsWith(".tif") ||
        currentFile.name.endsWith(".tiff")
      ) {
        supportedFileType = "other";
        contentType = "image/tiff";
      }

      if (currentFile.name.endsWith(".ecw")) {
        supportedFileType = "other";
        contentType = "image/x-ecw";
      }

      if (currentFile.name.endsWith(".bak")) {
        supportedFileType = "other";
        contentType = "application/x-bak";
      }

      if (isHtmlFile({ name: currentFile.name, contentType })) {
        supportedFileType = "html";
        contentType = "text/html";
      }

      if (!supportedFileType) {
        setUploading(false);
        toast.error(
          "Unsupported file format. Please upload a PDF, Powerpoint, Excel, Word or image file.",
        );
        return;
      }

      const { type, data, numPages, fileSize } = await putFile({
        file: currentFile,
        teamId,
      });

      const documentData: DocumentData = {
        name: currentFile.name,
        key: data!,
        storageType: type!,
        contentType: contentType,
        supportedFileType: supportedFileType,
        fileSize: fileSize,
      };
      let response: Response | undefined;
      // create a document or new version in the database
      if (!newVersion) {
        // create a document in the database
        response = await createDocument({
          documentData,
          teamId,
          numPages,
          folderPathName: currentFolderPath?.join("/"),
        });
      } else {
        // create a new version for existing document in the database
        const documentId = documentIdProp ?? (router.query.id as string);
        response = await createNewDocumentVersion({
          documentData,
          documentId,
          numPages,
          teamId,
        });
      }

      if (response) {
        const document = await response.json();

        if (isDataroom && dataroomId) {
          const dataroomResponse = await addDocumentToDataroom({
            documentId: document.id,
            folderPathName: currentFolderPath?.join("/"),
          });

          if (dataroomResponse?.ok) {
            const dataroomDocument =
              (await dataroomResponse.json()) as DataroomDocument & {
                dataroom: {
                  _count: { viewerGroups: number; permissionGroups: number };
                };
              };

            await applyUnifiedPermissionsToDocument(
              document,
              dataroomDocument,
              currentFolderPath,
            );
          }

          analytics.capture("Document Added", {
            documentId: document.id,
            name: document.name,
            numPages: document.numPages,
            path: router.asPath,
            type: document.type,
            teamId: teamId,
            dataroomId: dataroomId,
            $set: {
              teamId: teamId,
              teamPlan: plan,
            },
          });

          return;
        }

        if (!newVersion) {
          mutate(`/api/teams/${teamId}/documents`);
          toast.success("Document uploaded. Redirecting to document page...");

          analytics.capture("Document Added", {
            documentId: document.id,
            name: document.name,
            numPages: document.numPages,
            path: router.asPath,
            type: document.type,
            teamId: teamId,
            $set: {
              teamId: teamId,
              teamPlan: plan,
            },
          });

          // redirect to the document page
          router.push("/documents/" + document.id);
        } else {
          analytics.capture("Document Added", {
            documentId: document.id,
            name: document.name,
            numPages: document.numPages,
            path: router.asPath,
            type: document.type,
            newVersion: true,
            teamId: teamId,
            $set: {
              teamId: teamId,
              teamPlan: plan,
            },
          });
          toast.success("New document version uploaded.");

          // reload to the document page
          router.reload();
        }
      }
    } catch (error) {
      setUploading(false);
      toast.error("An error occurred while uploading the file.");
      console.error("An error occurred while uploading the file: ", error);
    } finally {
      setUploading(false);
      setIsOpen(false);
      setAddDocumentModalOpen && setAddDocumentModalOpen(false);
    }
  };

  const createNotionFileName = () => {
    // Extract Notion file name from the URL
    const urlSegments = (notionLink as string).split("/")[3];
    // Remove the last hyphen along with the Notion ID
    const extractName = urlSegments.replace(/-([^/-]+)$/, "");
    const notionFileName = extractName.replaceAll("-", " ") || "Notion Link";

    return notionFileName;
  };

  const handleNotionUpload = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();

    // Check if team is paused
    if (isPaused) {
      toast.error(
        "Your subscription is paused. Resume your subscription to upload documents.",
        {
          action: {
            label: "Go to Billing",
            onClick: () => router.push("/settings/billing"),
          },
        },
      );
      return;
    }

    if (!canAddDocuments) {
      toast.error(
        limits?.documents
          ? `You've reached your plan's document limit (${limits.usage?.documents}/${limits.documents} documents). Upgrade your plan to upload more.`
          : "You have reached the maximum number of documents.",
        {
          action: {
            label: "Upgrade",
            onClick: () => router.push("/settings/billing"),
          },
          duration: 8000,
        },
      );
      return;
    }

    // Check if the field is empty or not
    if (!notionLink) {
      toast.error("Please enter a Notion link to proceed.");
      return; // prevent form from submitting
    }

    // Validate URL format with Zod
    const urlSchema = z.string().url();
    const urlValidation = urlSchema.safeParse(notionLink);

    if (!urlValidation.success) {
      toast.error("Please enter a valid URL format.");
      return;
    }

    // Try to validate the Notion page URL
    let validateNotionPageId = parsePageId(notionLink);

    // If parsePageId fails, try to get page ID from slug
    if (validateNotionPageId === null) {
      try {
        const pageId = await getNotionPageIdFromSlug(notionLink);
        validateNotionPageId = pageId || undefined;
      } catch (slugError) {
        toast.error("Please enter a valid Notion link to proceed.");
        return;
      }
    }

    if (!validateNotionPageId) {
      toast.error("Please enter a valid Notion link to proceed.");
      return;
    }

    try {
      setUploading(true);

      const response = await fetch(
        `/api/teams/${teamInfo?.currentTeam?.id}/documents`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: createNotionFileName(),
            url: notionLink,
            numPages: 1,
            type: "notion",
            createLink: false,
            folderPathName: currentFolderPath?.join("/"),
          }),
        },
      );

      if (!response.ok) {
        const { error } = await response.json();
        toast.error(error);
        return;
      }

      const document = await response.json();

      if (isDataroom && dataroomId) {
        const dataroomResponse = await addDocumentToDataroom({
          documentId: document.id,
          folderPathName: currentFolderPath?.join("/"),
        });

        if (dataroomResponse?.ok) {
          const dataroomDocument =
            (await dataroomResponse.json()) as DataroomDocument & {
              dataroom: {
                _count: { viewerGroups: number; permissionGroups: number };
              };
            };

          await applyUnifiedPermissionsToDocument(
            document,
            dataroomDocument,
            currentFolderPath,
          );
        }

        analytics.capture("Document Added", {
          documentId: document.id,
          name: document.name,
          numPages: document.numPages,
          path: router.asPath,
          type: "notion",
          teamId: teamId,
          dataroomId: dataroomId,
          $set: {
            teamId: teamId,
            teamPlan: plan,
          },
        });

        return;
      }

      if (!newVersion) {
        toast.success("Notion Page processed. Redirecting to document page...");

        analytics.capture("Document Added", {
          documentId: document.id,
          name: document.name,
          fileSize: null,
          path: router.asPath,
          type: "notion",
          teamId: teamId,
          $set: {
            teamId: teamId,
            teamPlan: plan,
          },
        });

        // redirect to the document page
        router.push("/documents/" + document.id);
      }
    } catch (error) {
      setUploading(false);
      toast.error(
        "Oops! Can't access the Notion page. Please double-check it's set to 'Public'.",
      );
      console.error(
        "An error occurred while processing the Notion link: ",
        error,
      );
    } finally {
      setUploading(false);
      setIsOpen(false);
      setAddDocumentModalOpen && setAddDocumentModalOpen(false);
    }
  };

  const handleWebLinkUpload = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();

    // Check if user is on a free plan (not trial)
    if (isFree && !isTrial) {
      toast.error("Web links are available on Pro plan and above.");
      return;
    }

    if (!canAddDocuments) {
      toast.error(
        limits?.documents
          ? `You've reached your plan's document limit (${limits.usage?.documents}/${limits.documents} documents). Upgrade your plan to upload more.`
          : "You have reached the maximum number of documents.",
        {
          action: {
            label: "Upgrade",
            onClick: () => router.push("/settings/billing"),
          },
          duration: 8000,
        },
      );
      return;
    }

    // Check if the field is empty or not
    if (!webLink) {
      toast.error("Please enter a website URL to proceed.");
      return;
    }

    // Validate URL format with Zod
    const urlSchema = z.string().url();
    const urlValidation = urlSchema.safeParse(webLink);

    if (!urlValidation.success) {
      toast.error("Please enter a valid URL format.");
      return;
    }

    try {
      setUploading(true);

      // Extract domain name from URL for the document name
      let linkName = "Web Link";
      try {
        const url = new URL(webLink);
        linkName = url.hostname.replace("www.", "");
      } catch (e) {
        // Use default name if URL parsing fails
      }

      const response = await fetch(
        `/api/teams/${teamInfo?.currentTeam?.id}/documents`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: linkName,
            url: webLink,
            numPages: 1,
            type: "link",
            createLink: false,
            folderPathName: currentFolderPath?.join("/"),
          }),
        },
      );

      if (!response.ok) {
        const { error } = await response.json();
        toast.error(error);
        return;
      }

      const document = await response.json();

      if (isDataroom && dataroomId) {
        const dataroomResponse = await addDocumentToDataroom({
          documentId: document.id,
          folderPathName: currentFolderPath?.join("/"),
        });

        if (dataroomResponse?.ok) {
          const dataroomDocument =
            (await dataroomResponse.json()) as DataroomDocument & {
              dataroom: {
                _count: { viewerGroups: number; permissionGroups: number };
              };
            };

          await applyUnifiedPermissionsToDocument(
            document,
            dataroomDocument,
            currentFolderPath,
          );
        }

        analytics.capture("Document Added", {
          documentId: document.id,
          name: document.name,
          numPages: document.numPages,
          path: router.asPath,
          type: "link",
          teamId: teamId,
          dataroomId: dataroomId,
          $set: {
            teamId: teamId,
            teamPlan: plan,
          },
        });

        return;
      }

      if (!newVersion) {
        toast.success("Web link added. Redirecting to document page...");

        analytics.capture("Document Added", {
          documentId: document.id,
          name: document.name,
          fileSize: null,
          path: router.asPath,
          type: "link",
          teamId: teamId,
          $set: {
            teamId: teamId,
            teamPlan: plan,
          },
        });

        // redirect to the document page
        router.push("/documents/" + document.id);
      }
    } catch (error) {
      setUploading(false);
      toast.error("An error occurred while processing the web link.");
      console.error("An error occurred while processing the web link: ", error);
    } finally {
      setUploading(false);
      setIsOpen(false);
      setAddDocumentModalOpen && setAddDocumentModalOpen(false);
    }
  };

  const clearModelStates = () => {
    currentFile !== null && setCurrentFile(null);
    notionLink !== null && setNotionLink(null);
    webLink !== null && setWebLink(null);
    setUploadMode("file");
    setIsOpen(!isOpen);
    setAddDocumentModalOpen && setAddDocumentModalOpen(!isOpen);
  };

  if (!canAddDocuments && children) {
    if (newVersion) {
      return (
        <UpgradePlanModal
          clickedPlan={PlanEnum.Pro}
          trigger={"limit_upload_document_version"}
        >
          {children}
        </UpgradePlanModal>
      );
    }
    return (
      <UpgradePlanModal
        clickedPlan={PlanEnum.Pro}
        trigger={"limit_upload_documents"}
      >
        <Button>Upgrade to Add Documents</Button>
      </UpgradePlanModal>
    );
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={clearModelStates}>
        {children ? (
          <DialogTrigger asChild>{children}</DialogTrigger>
        ) : null}
        <DialogContent
          className="border-none bg-transparent text-foreground shadow-none"
          isDocumentDialog
        >
          <DialogTitle className="sr-only">Add Document</DialogTitle>
          <DialogDescription className="sr-only">
            An overlayed modal that can be clicked to upload a document
          </DialogDescription>
          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(value as "document" | "notion")
            }
          >
            {!newVersion ? (
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="document">Document</TabsTrigger>
                <TabsTrigger value="notion">Notion Page</TabsTrigger>
              </TabsList>
            ) : (
              <TabsList className="grid w-full grid-cols-1">
                <TabsTrigger value="document">Document</TabsTrigger>
              </TabsList>
            )}
            <TabsContent value="document">
              <Card>
                <CardHeader className="space-y-3">
                  <CardTitle>
                    {newVersion ? `Upload a new version` : `Share a document`}
                  </CardTitle>
                  <CardDescription>
                    {newVersion ? (
                      `After you upload a new version, the existing links will remain unchanged.`
                    ) : (
                      <span>
                        After you upload the document, create a shareable link.{" "}
                        {isFree && !isTrial ? (
                          <>
                            Upload larger files and more{" "}
                            <Link
                              href="https://www.papermark.com/help/article/document-types"
                              target="_blank"
                              className="underline underline-offset-4 transition-all hover:text-muted-foreground/80 hover:dark:text-muted-foreground/80"
                            >
                              file types
                            </Link>{" "}
                            with a higher plan.
                          </>
                        ) : null}
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {uploadMode === "file" ? (
                    <form
                      encType="multipart/form-data"
                      onSubmit={handleFileUpload}
                      className="flex flex-col space-y-4"
                    >
                      <div className="space-y-1">
                        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
                          <DocumentUpload
                            currentFile={currentFile}
                            setCurrentFile={setCurrentFile}
                          />
                        </div>
                      </div>

                      <div className="flex justify-center">
                        <Button
                          type="submit"
                          className="w-full lg:w-1/2"
                          disabled={uploading || !currentFile}
                          loading={uploading}
                        >
                          {uploading ? "Uploading..." : "Upload Document"}
                        </Button>
                      </div>

                      {!newVersion && (
                        <div className="flex justify-center">
                          <p className="text-sm text-muted-foreground">
                            Want to{" "}
                            <button
                              type="button"
                              className="underline-offset-4 transition-all hover:text-gray-800 hover:underline hover:dark:text-muted-foreground/80"
                              disabled={!uploadTriggers}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!uploadTriggers) return;
                                uploadTriggers.openFilesPicker();
                                clearModelStates();
                              }}
                            >
                              upload multiple files
                            </button>{" "}
                            or{" "}
                            {isFree && !isTrial ? (
                              <UpgradePlanModal
                                clickedPlan={PlanEnum.Pro}
                                trigger={"add_web_link_document"}
                              >
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 underline-offset-4 transition-all hover:text-gray-800 hover:underline hover:dark:text-muted-foreground/80"
                                >
                                  share link as a document
                                </button>
                              </UpgradePlanModal>
                            ) : (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 underline-offset-4 transition-all hover:text-gray-800 hover:underline hover:dark:text-muted-foreground/80"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setUploadMode("link");
                                }}
                              >
                                share link as a document
                              </button>
                            )}
                            ?
                          </p>
                        </div>
                      )}
                    </form>
                  ) : (
                    <form
                      encType="multipart/form-data"
                      onSubmit={handleWebLinkUpload}
                      className="flex flex-col space-y-4"
                    >
                      <div className="space-y-1">
                        <Label htmlFor="web-link">Website URL</Label>
                        <div className="mt-2">
                          <input
                            type="text"
                            name="web-link"
                            id="web-link"
                            placeholder="https://example.com"
                            className="flex w-full rounded-md border-0 bg-background py-1.5 text-foreground shadow-sm ring-1 ring-inset ring-input placeholder:text-muted-foreground focus:ring-2 focus:ring-inset focus:ring-gray-400 sm:text-sm sm:leading-6"
                            value={webLink || ""}
                            onChange={(e) => setWebLink(e.target.value)}
                          />
                        </div>
                        {/* <small className="text-xs text-muted-foreground">
                          The page will be captured and converted to a document format.
                        </small> */}
                      </div>

                      <div className="flex justify-center">
                        <Button
                          type="submit"
                          className="w-full lg:w-1/2"
                          disabled={uploading || !webLink}
                          loading={uploading}
                        >
                          {uploading ? "Saving..." : "Save Web Link"}
                        </Button>
                      </div>

                      <div className="flex justify-center">
                        <button
                          type="button"
                          className="flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 transition-all hover:text-gray-800 hover:underline hover:dark:text-muted-foreground/80"
                          onClick={(e) => {
                            e.preventDefault();
                            setUploadMode("file");
                          }}
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                            />
                          </svg>
                          Back to file upload
                        </button>
                      </div>
                    </form>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            {!newVersion && (
              <TabsContent value="notion">
                <Card>
                  <CardHeader className="space-y-3">
                    <CardTitle>Share a Notion Page</CardTitle>
                    <CardDescription>
                      After you submit the Notion link, a shareable link will be
                      generated and copied to your clipboard. Just like with a
                      PDF document.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <form
                      encType="multipart/form-data"
                      onSubmit={handleNotionUpload}
                      className="flex flex-col"
                    >
                      <div className="space-y-1 pb-8">
                        <Label htmlFor="notion-link">Notion Page Link</Label>
                        <div className="mt-2">
                          <input
                            type="text"
                            name="notion-link"
                            id="notion-link"
                            placeholder="notion.site/..."
                            className="flex w-full rounded-md border-0 bg-background py-1.5 text-foreground shadow-sm ring-1 ring-inset ring-input placeholder:text-muted-foreground focus:ring-2 focus:ring-inset focus:ring-gray-400 sm:text-sm sm:leading-6"
                            value={notionLink || ""}
                            onChange={(e) => setNotionLink(e.target.value)}
                          />
                        </div>
                        <small className="text-xs text-muted-foreground">
                          Your Notion page needs to be shared publicly.
                        </small>
                      </div>
                      <div className="flex justify-center">
                        <Button
                          type="submit"
                          className="w-full lg:w-1/2"
                          disabled={uploading || !notionLink}
                          loading={uploading}
                        >
                          {uploading ? "Saving..." : "Save Notion Link"}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>
        </DialogContent>
      </Dialog>

      {showGroupPermissions && dataroomId && (
        <SetUnifiedPermissionsModal
          open={showGroupPermissions}
          setOpen={setShowGroupPermissions}
          dataroomId={dataroomId}
          uploadedFiles={uploadedFiles}
          onComplete={() => {
            setShowGroupPermissions(false);
            setAddDocumentModalOpen?.(false);
            setUploadedFiles([]);
          }}
        />
      )}
    </>
  );
}
