import { GetStaticPropsContext } from "next";
import { useRouter } from "next/router";

import React, { useEffect, useState } from "react";

import { DataroomBrand } from "@prisma/client";
import Cookies from "js-cookie";
import { useSession } from "next-auth/react";
import { ExtendedRecordMap } from "notion-types";
import { parsePageId } from "notion-utils";
import z from "zod";

import { fetchLinkDataByDomainSlug } from "@/lib/api/links/link-data";
import { getFeatureFlags } from "@/lib/featureFlags";
import { useUrlPasscode } from "@/lib/hooks/use-url-passcode";
import {
  type ViewerI18nPageProps,
  buildViewerI18nPageProps,
} from "@/lib/i18n/viewer-page-props";
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
import { ViewerI18nProvider } from "@/components/view/viewer-i18n-provider";
import { ViewerNotFound } from "@/components/view/viewer-not-found";

type DataroomDocumentLinkData = {
  linkType: "DATAROOM_LINK";
  link: LinkWithDataroomDocument;
  brand: DataroomBrand | null;
};

type DataroomDocumentProps = Partial<ViewerI18nPageProps> & {
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
  hideFooterOnAccessForm: boolean;
  logoOnAccessForm: boolean;
  textSelectionEnabled?: boolean;
  frozen?: boolean;
  error?: boolean;
};

function DataroomDocumentViewPageInner({
  frozen,
  linkData,
  notionData,
  meta,
  showPoweredByBanner,
  showAccountCreationSlide,
  useAdvancedExcelViewer,
  hideFooterOnAccessForm,
  logoOnAccessForm,
  textSelectionEnabled,
  error,
}: DataroomDocumentProps) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [storedToken, setStoredToken] = useState<string | undefined>(undefined);
  const [storedEmail, setStoredEmail] = useState<string | undefined>(undefined);
  const urlPasscode = useUrlPasscode();

  useEffect(() => {
    // Retrieve token from cookie on component mount
    const cookieToken =
      Cookies.get("pm_vft") || Cookies.get(`pm_drs_flag_${router.query.slug}`);
    const storedEmail = window.localStorage.getItem("papermark.email");
    if (cookieToken) {
      setStoredToken(cookieToken);
      if (storedEmail) {
        setStoredEmail(storedEmail.toLowerCase());
      }
    }
  }, [router.query.slug]);

  if (router.isFallback) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <LoadingSpinner className="h-20 w-20" />
      </div>
    );
  }

  if (frozen) {
    return <ViewerNotFound reason="dataroomClosed" />;
  }

  if (error) {
    return <ViewerNotFound reason="loadErrorRetry" />;
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
  const disableEditPassword = !!disableEditEmail && !!urlPasscode;
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
    return <ViewerNotFound reason="expired" />;
  }

  // Check if the link is archived
  if (isArchived) {
    return <ViewerNotFound reason="archived" />;
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
        urlPasscode={urlPasscode}
        disableEditPassword={disableEditPassword}
        hideFooterOnAccessForm={hideFooterOnAccessForm}
        token={storedToken}
        verifiedEmail={verifiedEmail}
        preview={!!preview}
        logoOnAccessForm={logoOnAccessForm}
        textSelectionEnabled={textSelectionEnabled}
      />
    </>
  );
}

export default function DataroomDocumentViewPage(props: DataroomDocumentProps) {
  const locale = props.i18n?.locale ?? "en";
  const resources = props.i18n?.resources ?? {};
  return (
    <ViewerI18nProvider locale={locale} resources={resources}>
      <DataroomDocumentViewPageInner {...props} />
    </ViewerI18nProvider>
  );
}

export async function getStaticProps(context: GetStaticPropsContext) {
  const {
    domain: domainParam,
    slug: slugParam,
    documentId: documentIdParam,
  } = context.params as {
    domain: string;
    slug: string;
    documentId: string;
  };

  try {
    const domain = z
      .string()
      .regex(/^([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/)
      .parse(domainParam);
    const slug = z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/, "Invalid path parameter")
      .parse(slugParam);
    const documentId = z.string().cuid().parse(documentIdParam);

    const result = await fetchLinkDataByDomainSlug({
      domain,
      slug,
      dataroomDocumentId: documentId,
    });
    if (result.status === "frozen") {
      return {
        props: { frozen: true },
        revalidate: 10,
      };
    }

    if (result.status !== "ok") {
      return { notFound: true, revalidate: 10 };
    }

    const { linkType, link, brand, publicMeta } = result;

    if (!link || !linkType) {
      return { notFound: true, revalidate: 10 };
    }

    if (linkType !== "DATAROOM_LINK") {
      return { notFound: true, revalidate: 10 };
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
          revalidate: 10,
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
    const logoOnAccessFormEnabled = featureFlags.logoOnAccessForm;
    const hideFooterOnAccessFormEnabled = featureFlags.hideFooterOnAccessForm;

    const i18nProps = await buildViewerI18nPageProps(brand as any);

    return {
      props: {
        linkData: {
          linkType: "DATAROOM_LINK",
          link: {
            ...linkData,
            teamId: teamId || null,
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
          enableCustomMetatag: publicMeta.enableCustomMetatag,
          metaTitle: publicMeta.metaTitle,
          metaDescription: publicMeta.metaDescription,
          metaImage: publicMeta.metaImage,
          metaFavicon: publicMeta.metaFavicon,
          metaUrl: `https://${domain}/${slug}` || null,
        },
        showPoweredByBanner: false,
        showAccountCreationSlide: false,
        useAdvancedExcelViewer: advancedExcelEnabled,
        hideFooterOnAccessForm: hideFooterOnAccessFormEnabled,
        logoOnAccessForm: logoOnAccessFormEnabled,
        textSelectionEnabled,
        ...i18nProps,
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
