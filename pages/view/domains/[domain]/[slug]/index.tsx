import { GetStaticPropsContext } from "next";
import { useRouter } from "next/router";

import { useEffect, useState } from "react";

import WorkflowAccessView from "@/ee/features/workflows/components/workflow-access-view";
import { Brand, DataroomBrand } from "@prisma/client";
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
import {
  CustomUser,
  LinkWithDataroom,
  LinkWithDocument,
  NotionTheme,
} from "@/lib/types";

import LoadingSpinner from "@/components/ui/loading-spinner";
import CustomMetaTag from "@/components/view/custom-metatag";
import DataroomView from "@/components/view/dataroom/dataroom-view";
import DocumentView from "@/components/view/document-view";
import { ViewerI18nProvider } from "@/components/view/viewer-i18n-provider";
import { ViewerNotFound } from "@/components/view/viewer-not-found";

type DocumentLinkData = {
  linkType: "DOCUMENT_LINK";
  link: LinkWithDocument;
  brand: Brand | null;
};

type DataroomLinkData = {
  linkType: "DATAROOM_LINK";
  link: LinkWithDataroom;
  brand: DataroomBrand | null;
};

type WorkflowLinkData = {
  linkType: "WORKFLOW_LINK";
  entryLinkId: string;
  domain: string;
  slug: string;
  brand: Brand | null;
};

export const getStaticProps = async (context: GetStaticPropsContext) => {
  const { domain: domainParam, slug: slugParam } = context.params as {
    domain: string;
    slug: string;
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

    const result = await fetchLinkDataByDomainSlug({ domain, slug });
    if (result.status === "frozen") {
      return {
        props: {
          frozen: true,
        },
        revalidate: 10,
      };
    }
    if (result.status !== "ok") {
      return {
        notFound: true,
        revalidate: 10,
      };
    }

    const { linkType, link, brand, linkId, publicMeta } = result;

    if (!linkType) {
      return {
        notFound: true,
        revalidate: 10,
      };
    }

    const i18nProps = await buildViewerI18nPageProps(brand as any);

    // Handle workflow links - minimal props needed
    if (linkType === "WORKFLOW_LINK") {
      return {
        props: {
          linkData: {
            linkType: "WORKFLOW_LINK",
            entryLinkId: linkId || "",
            domain,
            slug,
            brand: brand || null,
          },
          notionData: {
            rootNotionPageId: null,
            recordMap: null,
            theme: null,
          },
          meta: {
            enableCustomMetatag: publicMeta.enableCustomMetatag,
            metaTitle: publicMeta.metaTitle,
            metaDescription: publicMeta.metaDescription,
            metaImage: publicMeta.metaImage,
            metaUrl: `https://${domain}/${slug}`,
            metaFavicon: publicMeta.metaFavicon,
          },
          showPoweredByBanner: false,
          showAccountCreationSlide: false,
          useAdvancedExcelViewer: false,
          hideFooterOnAccessForm: false,
          logoOnAccessForm: false,
          ...i18nProps,
        },
        revalidate: 60,
      };
    }

    if (!link) {
      return {
        notFound: true,
        revalidate: 10,
      };
    }

    // Manage the data for the document link
    if (linkType === "DOCUMENT_LINK") {
      let pageId = null;
      let recordMap = null;
      let theme = null;

      const { type, file, ...versionWithoutTypeAndFile } =
        link.document.versions[0];

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
        await addSignedUrls({ recordMap });
      }

      const { team, teamId, advancedExcelEnabled, ...linkDocument } =
        link.document;
      const teamPlan = team?.plan || "free";

      // Check feature flags for document links
      const docFeatureFlags = await getFeatureFlags({
        teamId: teamId || undefined,
      });
      const textSelectionEnabled = docFeatureFlags.textSelection;
      const logoOnAccessFormEnabled = docFeatureFlags.logoOnAccessForm;
      const hideFooterOnAccessFormEnabled =
        docFeatureFlags.hideFooterOnAccessForm;

      return {
        props: {
          linkData: {
            linkType: "DOCUMENT_LINK",
            link: {
              ...link,
              teamId: teamId || null,
              document: {
                ...linkDocument,
                versions: [versionWithoutTypeAndFile],
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
          showAccountCreationSlide: link.showBanner || teamPlan === "free",
          useAdvancedExcelViewer: advancedExcelEnabled,
          hideFooterOnAccessForm: hideFooterOnAccessFormEnabled,
          logoOnAccessForm: logoOnAccessFormEnabled,
          textSelectionEnabled,
          ...i18nProps,
        },
        revalidate: 10,
      };
    }

    // Manage the data for the dataroom link
    if (linkType === "DATAROOM_LINK") {
      // iterate the link.documents and extract type and file and rest of the props
      let documents = [];
      for (const document of link.dataroom.documents) {
        const { file, updatedAt, ...versionWithoutTypeAndFile } =
          document.document.versions[0];

        const newDocument = {
          ...document.document,
          dataroomDocumentId: document.id,
          folderId: document.folderId,
          orderIndex: document.orderIndex,
          hierarchicalIndex: document.hierarchicalIndex,
          versions: [
            {
              ...versionWithoutTypeAndFile,
              updatedAt:
                document.updatedAt > updatedAt ? document.updatedAt : updatedAt, // use the latest updatedAt
            },
          ],
        };

        documents.push(newDocument);
      }

      const { teamId } = link.dataroom;

      const featureFlags = await getFeatureFlags({ teamId });
      const dataroomIndexEnabled =
        result.dataroomIndexEnabledForViewer ?? false;
      const textSelectionEnabled = featureFlags.textSelection;
      const logoOnAccessFormEnabled = featureFlags.logoOnAccessForm;
      const hideFooterOnAccessFormEnabled = featureFlags.hideFooterOnAccessForm;

      const lastUpdatedAt = link.dataroom.documents.reduce(
        (max: number, doc: any) => {
          return Math.max(
            max,
            new Date(doc.document.versions[0].updatedAt).getTime(),
          );
        },
        new Date(link.dataroom.createdAt).getTime(),
      );

      return {
        props: {
          linkData: {
            linkType: "DATAROOM_LINK",
            link: {
              ...link,
              teamId: teamId || null,
              dataroom: {
                ...link.dataroom,
                documents,
                lastUpdatedAt: lastUpdatedAt,
              },
            },
            brand,
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
          useAdvancedExcelViewer: false, // INFO: this is managed in the API route
          hideFooterOnAccessForm: hideFooterOnAccessFormEnabled,
          logoOnAccessForm: logoOnAccessFormEnabled,
          dataroomIndexEnabled,
          textSelectionEnabled,
          ...i18nProps,
        },
        revalidate: 10,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Fetching error:", message);
    return { props: { error: true }, revalidate: 30 };
  }
};

export async function getStaticPaths() {
  return {
    paths: [],
    fallback: true,
  };
}

type DomainViewPageProps = Partial<ViewerI18nPageProps> & {
  frozen?: boolean;
  linkData: DocumentLinkData | DataroomLinkData | WorkflowLinkData;
  notionData: {
    rootNotionPageId: string | null;
    recordMap: ExtendedRecordMap | null;
    theme: NotionTheme | null;
  };
  meta: {
    enableCustomMetatag: boolean;
    metaTitle: string | null;
    metaFavicon: string | null;
    metaDescription: string | null;
    metaImage: string | null;
    metaUrl: string | null;
  };
  showAccountCreationSlide: boolean;
  useAdvancedExcelViewer: boolean;
  hideFooterOnAccessForm: boolean;
  logoOnAccessForm: boolean;
  dataroomIndexEnabled?: boolean;
  textSelectionEnabled?: boolean;
  error?: boolean;
};

function ViewPageInner({
  frozen,
  linkData,
  notionData,
  meta,
  showAccountCreationSlide,
  useAdvancedExcelViewer,
  hideFooterOnAccessForm,
  logoOnAccessForm,
  dataroomIndexEnabled,
  textSelectionEnabled,
  error,
}: DomainViewPageProps) {
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
  const { linkType } = linkData;

  // Render workflow access view for WORKFLOW_LINK
  if (linkType === "WORKFLOW_LINK") {
    const { entryLinkId, domain, slug, brand } = linkData as WorkflowLinkData;

    return (
      <>
        <CustomMetaTag
          favicon={meta.metaFavicon}
          enableBranding={false}
          title="Access Workflow | Powered by Papermark"
          description={null}
          imageUrl={null}
          url={meta.metaUrl ?? ""}
        />
        <WorkflowAccessView
          entryLinkId={entryLinkId}
          domain={domain}
          slug={slug}
          brand={brand}
        />
      </>
    );
  }

  // Render the document view for DOCUMENT_LINK
  if (linkType === "DOCUMENT_LINK") {
    const { link, brand } = linkData as DocumentLinkData;

    if (!link || status === "loading") {
      return (
        <>
          <CustomMetaTag
            favicon={meta.metaFavicon}
            enableBranding={meta.enableCustomMetatag ?? false}
            title={
              meta.metaTitle ?? `${link?.document?.name} | Powered by Papermark`
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
      password: linkPassword,
      enableAgreement,
      isArchived,
    } = link;

    const { email: userEmail, id: userId } =
      (session?.user as CustomUser) || {};

    // If the link is expired, show a 404 page
    if (expiresAt && new Date(expiresAt) < new Date()) {
      return <ViewerNotFound reason="expired" />;
    }

    if (isArchived) {
      return <ViewerNotFound reason="archived" />;
    }

    return (
      <>
        <CustomMetaTag
          favicon={meta.metaFavicon}
          enableBranding={meta.enableCustomMetatag ?? false}
          title={
            meta.metaTitle ?? `${link?.document?.name} | Powered by Papermark`
          }
          description={meta.metaDescription ?? null}
          imageUrl={meta.metaImage ?? null}
          url={meta.metaUrl ?? ""}
        />
        <DocumentView
          link={link}
          userEmail={verifiedEmail ?? storedEmail ?? userEmail}
          userId={userId}
          isProtected={!!(emailProtected || linkPassword || enableAgreement)}
          notionData={notionData}
          brand={brand}
          showAccountCreationSlide={showAccountCreationSlide}
          useAdvancedExcelViewer={useAdvancedExcelViewer}
          previewToken={previewToken}
          disableEditEmail={!!disableEditEmail}
          urlPasscode={urlPasscode}
          disableEditPassword={disableEditPassword}
          hideFooterOnAccessForm={hideFooterOnAccessForm}
          token={storedToken}
          verifiedEmail={verifiedEmail}
          logoOnAccessForm={logoOnAccessForm}
          textSelectionEnabled={textSelectionEnabled}
        />
      </>
    );
  }

  // Render the dataroom view for DATAROOM_LINK
  if (linkType === "DATAROOM_LINK") {
    const { link, brand } = linkData as DataroomLinkData;

    if (!link || status === "loading" || router.isFallback) {
      return (
        <>
          <CustomMetaTag
            favicon={meta.metaFavicon}
            enableBranding={meta.enableCustomMetatag ?? false}
            title={
              meta.metaTitle ?? `${link?.dataroom?.name} | Powered by Papermark`
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

    const { email: userEmail, id: userId } =
      (session?.user as CustomUser) || {};

    // If the link is expired, show a 404 page
    if (expiresAt && new Date(expiresAt) < new Date()) {
      return <ViewerNotFound reason="expired" />;
    }

    if (isArchived) {
      return <ViewerNotFound reason="archived" />;
    }

    return (
      <>
        <CustomMetaTag
          favicon={meta.metaFavicon}
          enableBranding={meta.enableCustomMetatag ?? false}
          title={
            meta.metaTitle ?? `${link?.dataroom?.name} | Powered by Papermark`
          }
          description={meta.metaDescription ?? null}
          imageUrl={meta.metaImage ?? null}
          url={meta.metaUrl ?? ""}
        />
        <DataroomView
          link={link}
          userEmail={verifiedEmail ?? storedEmail ?? userEmail}
          userId={userId}
          isProtected={!!(emailProtected || linkPassword || enableAgreement)}
          brand={brand}
          disableEditEmail={!!disableEditEmail}
          urlPasscode={urlPasscode}
          disableEditPassword={disableEditPassword}
          hideFooterOnAccessForm={hideFooterOnAccessForm}
          token={storedToken}
          verifiedEmail={verifiedEmail}
          previewToken={previewToken}
          preview={!!preview}
          logoOnAccessForm={logoOnAccessForm}
          dataroomIndexEnabled={dataroomIndexEnabled}
          textSelectionEnabled={textSelectionEnabled}
        />
      </>
    );
  }
}

export default function ViewPage(props: DomainViewPageProps) {
  const locale = props.i18n?.locale ?? "en";
  const resources = props.i18n?.resources ?? {};
  return (
    <ViewerI18nProvider locale={locale} resources={resources}>
      <ViewPageInner {...props} />
    </ViewerI18nProvider>
  );
}
