import { GetStaticPropsContext } from "next";
import { useRouter } from "next/router";

import React, { useEffect, useState } from "react";

import NotFound from "@/pages/404";
import { DataroomBrand } from "@prisma/client";
import Cookies from "js-cookie";
import { useSession } from "next-auth/react";
import { ExtendedRecordMap } from "notion-types";
import { parsePageId } from "notion-utils";
import z from "zod";

import { fetchLinkDataById } from "@/lib/api/links/link-data";
import { getFeatureFlags } from "@/lib/featureFlags";
import notion from "@/lib/notion";
import {
  addSignedUrls,
  fetchMissingPageReferences,
  normalizeRecordMap,
} from "@/lib/notion/utils";
import { CustomUser, LinkWithDataroomDocument, NotionTheme } from "@/lib/types";

import LoadingSpinner from "@/components/ui/loading-spinner";
import CustomMetaTag from "@/components/view/custom-metatag";
import DataroomDocumentView from "@/components/view/dataroom/dataroom-document-view";

type DataroomDocumentLinkData = {
  linkType: "DATAROOM_LINK";
  link: LinkWithDataroomDocument;
  brand: DataroomBrand | null;
};

type DataroomDocumentProps = {
  linkData: DataroomDocumentLinkData;
  notionData: {
    rootNotionPageId: string | null;
    recordMap: ExtendedRecordMap | null;
    theme: NotionTheme | null;
  };
  meta: {
    enableCustomMetatag: boolean;
    metaTitle: string | null;
    metaDescription: string | null;
    metaImage: string | null;
    metaFavicon: string;
    metaUrl: string;
  };
  showPoweredByBanner: boolean;
  showAccountCreationSlide: boolean;
  useAdvancedExcelViewer: boolean;
  useCustomAccessForm: boolean;
  logoOnAccessForm: boolean;
  textSelectionEnabled?: boolean;
  frozen?: boolean;
  error?: boolean;
};

export default function DataroomDocumentViewPage({
  frozen,
  linkData,
  notionData,
  meta,
  showPoweredByBanner,
  showAccountCreationSlide,
  useAdvancedExcelViewer,
  useCustomAccessForm,
  logoOnAccessForm,
  textSelectionEnabled,
  error,
}: DataroomDocumentProps) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [storedToken, setStoredToken] = useState<string | undefined>(undefined);
  const [storedEmail, setStoredEmail] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Retrieve token from cookie on component mount
    const cookieToken = Cookies.get(`pm_drs_flag_${router.query.linkId}`);
    const storedEmail = window.localStorage.getItem("papermark.email");
    if (cookieToken) {
      setStoredToken(cookieToken);
      if (storedEmail) {
        setStoredEmail(storedEmail.toLowerCase());
      }
    }
  }, [router.query.linkId]);

  if (router.isFallback) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <LoadingSpinner className="h-20 w-20" />
      </div>
    );
  }

  if (frozen) {
    return (
      <NotFound message="This data room has been closed and is no longer available." />
    );
  }

  if (error) {
    return (
      <NotFound message="Sorry, we had trouble loading this link. Please try again in a moment." />
    );
  }

  const {
    email: verifiedEmail,
    d: disableEditEmail,
    previewToken,
    preview,
  } = router.query as {
    email: string;
    d: string;
    previewToken?: string;
    preview?: string;
  };
  const { link, brand } = linkData;

  // Render the document view for DATAROOM_LINK
  if (!linkData || status === "loading" || router.isFallback) {
    return (
      <>
        <CustomMetaTag
          favicon={meta.metaFavicon}
          enableBranding={meta.enableCustomMetatag ?? false}
          title={
            meta.metaTitle ??
            `${link?.dataroomDocument?.document?.name} | Powered by Papermark`
          }
          description={meta.metaDescription ?? null}
          imageUrl={meta.metaImage ?? null}
          url={meta.metaUrl ?? ""}
        />
        <div className="flex h-screen items-center justify-center">
          <LoadingSpinner className="h-20 w-20" />
        </div>
      </>
    );
  }

  const {
    expiresAt,
    emailProtected,
    emailAuthenticated,
    password: linkPassword,
    enableAgreement,
    isArchived,
  } = link;

  const { email: userEmail, id: userId } = (session?.user as CustomUser) || {};

  // Check if the link is expired
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return (
      <NotFound message="Sorry, the link you're looking for is expired." />
    );
  }

  // Check if the link is archived
  if (isArchived) {
    return (
      <NotFound message="Sorry, the link you're looking for is archived." />
    );
  }

  return (
    <>
      <CustomMetaTag
        favicon={meta.metaFavicon}
        enableBranding={meta.enableCustomMetatag ?? false}
        title={
          meta.metaTitle ??
          `${link?.dataroomDocument?.document?.name} | Powered by Papermark`
        }
        description={meta.metaDescription ?? null}
        imageUrl={meta.metaImage ?? null}
        url={meta.metaUrl ?? ""}
      />
      <DataroomDocumentView
        link={link}
        userEmail={verifiedEmail ?? storedEmail ?? userEmail}
        userId={userId}
        isProtected={!!(emailProtected || linkPassword || enableAgreement)}
        notionData={notionData}
        brand={brand}
        useAdvancedExcelViewer={useAdvancedExcelViewer}
        previewToken={previewToken}
        disableEditEmail={!!disableEditEmail}
        useCustomAccessForm={useCustomAccessForm}
        logoOnAccessForm={logoOnAccessForm}
        token={storedToken}
        verifiedEmail={verifiedEmail}
        preview={!!preview}
        textSelectionEnabled={textSelectionEnabled}
      />
    </>
  );
}

export async function getStaticProps(context: GetStaticPropsContext) {
  const { linkId: linkIdParam, documentId: documentIdParam } =
    context.params as {
      linkId: string;
      documentId: string;
    };

  try {
    const linkId = z.string().cuid().parse(linkIdParam);
    const documentId = z.string().cuid().parse(documentIdParam);

    // Fetch link data directly from database to avoid internal HTTP fetch
    // which can be blocked by Vercel's edge protection (403 errors)
    const result = await fetchLinkDataById({
      linkId,
      dataroomDocumentId: documentId,
    });

    if (result.status === "frozen") {
      return {
        props: { frozen: true },
        revalidate: 10,
      };
    }

    if (result.status !== "ok") {
      return { notFound: true };
    }

    const { linkType, link, brand } = result;

    if (!link || !linkType) {
      return { notFound: true };
    }

    if (linkType !== "DATAROOM_LINK") {
      return { notFound: true };
    }

    let pageId = null;
    let recordMap = null;
    let theme = null;

    const { type, file, ...versionWithoutTypeAndFile } =
      link.dataroomDocument.document.versions[0];

    if (type === "notion") {
      theme = new URL(file).searchParams.get("mode");
      const notionPageId = parsePageId(file, { uuid: false });
      if (!notionPageId) {
        return {
          notFound: true,
        };
      }

      pageId = notionPageId;
      recordMap = await notion.getPage(pageId, { signFileUrls: false });
      // Fetch missing page references that are embedded in rich text (e.g., table cells with multiple page links)
      await fetchMissingPageReferences(recordMap);
      // Normalize double-nested block structures from the Notion API
      normalizeRecordMap(recordMap);
      // TODO: separately sign the file urls until PR merged and published; ref: https://github.com/NotionX/react-notion-x/issues/580#issuecomment-2542823817
      await addSignedUrls({ recordMap });
    }

    const { teamId, team, ...linkData } = link;

    const { advancedExcelEnabled, ...linkDocument } =
      linkData.dataroomDocument.document;

    // Check feature flags
    const featureFlags = await getFeatureFlags({ teamId: teamId || undefined });
    const textSelectionEnabled = featureFlags.textSelection;

    return {
      props: {
        linkData: {
          linkType: "DATAROOM_LINK",
          link: {
            ...linkData,
            teamId: teamId,
            dataroomDocument: {
              ...linkData.dataroomDocument,
              document: {
                ...linkDocument,
                versions: [versionWithoutTypeAndFile],
              },
            },
          },
          brand,
        },
        notionData: {
          rootNotionPageId: null, // do not pass rootNotionPageId to the client
          recordMap,
          theme,
        },
        meta: {
          enableCustomMetatag: link.enableCustomMetatag || false,
          metaTitle: link.metaTitle,
          metaDescription: link.metaDescription,
          metaImage: link.metaImage,
          metaFavicon: link.metaFavicon ?? "/favicon.ico",
          metaUrl: `https://www.papermark.com/view/${linkId}`,
        },
        showPoweredByBanner: false,
        showAccountCreationSlide: false,
        useAdvancedExcelViewer: advancedExcelEnabled,
        useCustomAccessForm:
          teamId === "cm0154tiv0000lr2t6nr5c6kp" ||
          teamId === "clup33by90000oewh4rfvp2eg" ||
          teamId === "cm76hfyvy0002q623hmen99pf" ||
          teamId === "cm9ztf0s70005js04i689gefn" ||
          teamId === "cmk2hnmqh0000k304zcoezt6n",
        logoOnAccessForm: teamId === "cm7nlkrhm0000qgh0nvyrrywr",
        textSelectionEnabled,
      },
      revalidate: brand || recordMap ? 10 : 60,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Fetching error:", message);
    return { props: { error: true }, revalidate: 30 };
  }
}

export async function getStaticPaths() {
  return {
    paths: [],
    fallback: true,
  };
}
