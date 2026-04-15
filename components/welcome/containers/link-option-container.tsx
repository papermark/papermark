import { useRouter } from "next/router";

import { Dispatch, SetStateAction, useState } from "react";

import { useTeam } from "@/context/team-context";
import { LinkType } from "@prisma/client";
import { motion } from "motion/react";
import { toast } from "sonner";

import { STAGGER_CHILD_VARIANTS } from "@/lib/constants";
import {
  convertDataUrlToFile,
  copyToClipboard,
  uploadImage,
} from "@/lib/utils";

import { DEFAULT_LINK_TYPE } from "@/components/links/link-sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OnboardingDataroomLinkOptions } from "@/components/welcome/containers/onboarding-dataroom-link-options";
import { OnboardingLinkOptions } from "@/components/welcome/containers/onboarding-link-options";

export function LinkOptionContainer({
  currentLinkId,
  currentDocId,
  currentDataroomId,
  linkData,
  setLinkData,
}: {
  currentLinkId: string | null;
  currentDocId?: string | null;
  currentDataroomId?: string | null;
  linkData: DEFAULT_LINK_TYPE;
  setLinkData: Dispatch<SetStateAction<DEFAULT_LINK_TYPE>>;
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showLinkSettings, setShowLinkSettings] = useState<boolean>(true);

  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const handleSubmit = async (event: any) => {
    event.preventDefault();

    setIsLoading(true);

    let blobUrl: string | null =
      linkData.metaImage && linkData.metaImage.startsWith("data:")
        ? null
        : linkData.metaImage;
    if (linkData.metaImage && linkData.metaImage.startsWith("data:")) {
      const blob = convertDataUrlToFile({ dataUrl: linkData.metaImage });
      blobUrl = await uploadImage(blob);
      setLinkData({ ...linkData, metaImage: blobUrl });
    }

    const response = await fetch(`/api/links/${currentLinkId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...linkData,
        metaImage: blobUrl,
        targetId: currentDataroomId || currentDocId,
        linkType: currentDataroomId
          ? LinkType.DATAROOM_LINK
          : LinkType.DOCUMENT_LINK,
        teamId,
      }),
    });

    if (!response.ok) {
      const { error } = await response.json();
      toast.error(error);
      setIsLoading(false);
      return;
    }

    if (currentDataroomId) {
      copyToClipboard(
        `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${currentLinkId}`,
        `Link copied to clipboard. Redirecting to dataroom page...`,
      );
      router.push(`/datarooms/${currentDataroomId}/documents`);
    } else {
      copyToClipboard(
        `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${currentLinkId}`,
        `Link copied to clipboard. Redirecting to document page...`,
      );
      router.push(`/documents/${currentDocId}`);
    }
    setIsLoading(false);
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
        <h1
          className={
            `font-display mx-auto text-center text-3xl font-semibold text-foreground transition-colors sm:text-4xl ` +
            (showLinkSettings ? "" : "max-w-md")
          }
        >
          {showLinkSettings
            ? currentDataroomId
              ? "Configure your dataroom link"
              : "Configure your document link"
            : currentDataroomId
              ? "Securely share your unique dataroom link"
              : "Securely share your unique document link"}
        </h1>
      </motion.div>

      <motion.div variants={STAGGER_CHILD_VARIANTS}>
        {showLinkSettings && (
          <main className="max-h-[calc(100dvh-10rem)] min-h-[300px] overflow-y-scroll scrollbar-hide">
            <div className="flex flex-col justify-center">
              <div className="w-full max-w-xs pb-8 sm:max-w-lg">
                {currentDataroomId ? (
                  <OnboardingDataroomLinkOptions
                    data={linkData}
                    setData={setLinkData}
                    currentPreset={undefined}
                  />
                ) : (
                  <OnboardingLinkOptions
                    data={linkData}
                    setData={setLinkData}
                    linkType={LinkType.DOCUMENT_LINK}
                    currentPreset={undefined}
                  />
                )}
              </div>
              <div className="mb-4 flex items-center justify-center">
                <Button onClick={() => setShowLinkSettings(false)}>
                  Share {currentDataroomId ? `Dataroom` : `Document`}
                </Button>
              </div>
              <div className="text-center text-xs text-muted-foreground">
                <span>You can always change settings later.</span>
              </div>
            </div>
          </main>
        )}
        {!showLinkSettings &&
          currentLinkId &&
          (currentDocId || currentDataroomId) && (
            <main className="max-h-[calc(100dvh-10rem)] min-h-[300px] overflow-y-scroll scrollbar-hide">
              <div className="flex flex-col justify-center">
                <div className="relative">
                  <div className="flex py-8">
                    <div className="flex w-fit focus-within:z-10">
                      <p className="block rounded-md border-0 bg-secondary px-4 py-1.5 text-left leading-6 text-secondary-foreground md:min-w-[500px]">
                        {`${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${currentLinkId}`}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mb-4 flex items-center justify-center">
                  <Button onClick={handleSubmit} loading={isLoading}>
                    Copy & Share
                  </Button>
                </div>
                {!currentDataroomId && (
                  <div className="text-center text-xs text-muted-foreground">
                    <span>To see page by page analytics</span>
                  </div>
                )}
              </div>
            </main>
          )}
      </motion.div>
    </motion.div>
  );
}
