import { useRouter } from "next/router";

import { Dispatch, SetStateAction, useState } from "react";

import { useTeam } from "@/context/team-context";
import { motion } from "motion/react";
import { toast } from "sonner";
import z from "zod";

import { useAnalytics } from "@/lib/analytics";
import { STAGGER_CHILD_VARIANTS } from "@/lib/constants";
import { DocumentData, createDocument } from "@/lib/documents/create-document";
import { putFile } from "@/lib/files/put-file";
import { getSupportedContentType } from "@/lib/utils/get-content-type";

import DocumentUpload from "@/components/document-upload";
import { Button } from "@/components/ui/button";

export function UploadContainer({
  currentFile,
  setCurrentFile,
  setCurrentBlob,
  setCurrentLinkId,
  setCurrentDocId,
  dataroomId,
}: {
  currentFile: File | null;
  setCurrentFile: Dispatch<SetStateAction<File | null>>;
  setCurrentBlob: Dispatch<SetStateAction<boolean>>;
  setCurrentLinkId: Dispatch<SetStateAction<string | null>>;
  setCurrentDocId?: Dispatch<SetStateAction<string | null>>;
  dataroomId?: string;
}) {
  const router = useRouter();
  const analytics = useAnalytics();
  const [uploading, setUploading] = useState<boolean>(false);

  const { currentTeamId: teamId } = useTeam();

  const handleBrowserUpload = async (event: any) => {
    event.preventDefault();

    // Check if the file is chosen
    if (!currentFile) {
      toast.error("Please select a file to upload.");
      return; // prevent form from submitting
    }

    try {
      setUploading(true);

      const contentType = currentFile.type;
      const supportedFileType = getSupportedContentType(currentFile.type);

      if (!supportedFileType) {
        setUploading(false);
        toast.error(
          "Unsupported file format. Please upload a PDF, Powerpoint, Excel, or Word file.",
        );
        return;
      }

      const { type, data, numPages, fileSize } = await putFile({
        file: currentFile,
        teamId: teamId as string,
      });

      setCurrentFile(null);
      setCurrentBlob(true);

      const documentData: DocumentData = {
        name: currentFile.name,
        key: data!,
        storageType: type!,
        contentType: contentType,
        supportedFileType: supportedFileType,
        fileSize: fileSize,
      };
      // create a document in the database
      const response = await createDocument({
        documentData,
        teamId: teamId as string,
        numPages,
        createLink: dataroomId ? false : true, // don't create a link if the document is being added to a dataroom
      });

      if (response) {
        const document = await response.json();

        if (dataroomId) {
          // add document to dataroom
          try {
            const dataroomIdParsed = z.string().cuid().parse(dataroomId);

            await fetch(
              `/api/teams/${teamId}/datarooms/${dataroomIdParsed}/documents`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ documentId: document.id }),
              },
            );

            analytics.capture("Document Added to Dataroom", {
              documentId: document.id,
              name: document.name,
              numPages: document.numPages,
              path: router.asPath,
              type: document.type,
              teamId: teamId,
              dataroomId: dataroomId,
            });

            // create link to dataroom
            const newLinkResponse = await fetch(`/api/links`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                targetId: dataroomId,
                linkType: "DATAROOM_LINK",
                teamId,
              }),
            });

            if (newLinkResponse.ok) {
              const link = await newLinkResponse.json();
              setCurrentLinkId(link.id);

              analytics.capture("Link Added", {
                linkId: link.id,
                dataroomId: dataroomId,
                customDomain: null,
                teamId: teamId,
              });
            }

            setTimeout(() => {
              setUploading(false);
            }, 2000);
          } catch (error) {
            console.error("Error adding document to dataroom:", error);
            toast.error("Failed to add document to dataroom");
            setUploading(false);
            return;
          }
        } else {
          const linkId = document.links[0].id;

          // track the event
          analytics.capture("Document Added", {
            documentId: document.id,
            name: document.name,
            numPages: document.numPages,
            path: router.asPath,
            type: document.type,
            contentType: document.contentType,
            teamId: teamId,
          });
          analytics.capture("Link Added", {
            linkId: linkId,
            documentId: document.id,
            customDomain: null,
            teamId: teamId,
          });

          setTimeout(() => {
            setCurrentDocId && setCurrentDocId(document.id);
            setCurrentLinkId(linkId);
            setUploading(false);
          }, 2000);
        }
      }
    } catch (error) {
      console.error("An error occurred while uploading the file: ", error);
      setCurrentFile(null);
      setUploading(false);
    }
  };

  return (
    <motion.div
      className="z-10 flex flex-col space-y-10 px-5 text-center sm:px-0"
      variants={{
        hidden: { opacity: 0, scale: 0.95 },
        show: {
          opacity: 1,
          scale: 1,
          transition: {
            staggerChildren: 0.2,
          },
        },
      }}
      initial="hidden"
      animate="show"
      exit="hidden"
      transition={{ duration: 0.3, type: "spring" }}
    >
      <motion.div
        variants={STAGGER_CHILD_VARIANTS}
        className="flex flex-col items-center space-y-10 text-center"
      >
        <h1 className="font-display text-balance text-3xl font-semibold text-foreground transition-colors sm:text-4xl">
          {dataroomId
            ? `Upload your first document to your data room`
            : `Upload your ${
                router.query.type === "sales-document"
                  ? "document"
                  : `${router.query.type}`
              }`}
        </h1>
      </motion.div>
      <motion.div variants={STAGGER_CHILD_VARIANTS}>
        <main className="mx-auto mt-8 max-w-md">
          <form
            encType="multipart/form-data"
            onSubmit={handleBrowserUpload}
            className="flex flex-col"
          >
            <div className="space-y-12">
              <div className="pb-6">
                <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
                  <DocumentUpload
                    currentFile={currentFile}
                    setCurrentFile={setCurrentFile}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <Button
                type="submit"
                className="w-full"
                loading={uploading}
                disabled={!currentFile}
              >
                {uploading ? "Uploading..." : "Upload Document"}
              </Button>
            </div>
          </form>

          <div className="text-xs text-muted-foreground">
            <span>Use our</span>{" "}
            <Button
              variant="link"
              className="px-0 text-xs font-normal text-muted-foreground underline hover:text-gray-700"
              onClick={async () => {
                const response = await fetch(
                  "/_example/papermark-example-document.pdf",
                );
                const blob = await response.blob();
                const file = new File(
                  [blob],
                  "papermark-example-document.pdf",
                  {
                    type: "application/pdf",
                  },
                );
                setCurrentFile(file);
              }}
            >
              sample document
            </Button>
          </div>
        </main>
      </motion.div>
    </motion.div>
  );
}
