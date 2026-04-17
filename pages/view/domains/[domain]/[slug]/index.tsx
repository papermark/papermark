import { GetStaticPropsContext } from "next";
import { useRouter } from "next/router";

import { useEffect, useState } from "react";

import WorkflowAccessView from "@/ee/features/workflows/components/workflow-access-view";
import NotFound from "@/pages/404";
import { Brand, DataroomBrand } from "@prisma/client";
import Cookies from "js-cookie";
import { useSession } from "next-auth/react";
import { ExtendedRecordMap } from "notion-types";
import { parsePageId } from "notion-utils";
import z from "zod";

import { fetchLinkDataByDomainSlug } from "@/lib/api/links/link-data";
import { getFeatureFlags } from "@/lib/featureFlags";
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

    const { linkType, link, brand, linkId } = result;

    if (!linkType) {
      return {
        notFound: true,
        revalidate: 10,
      };
    }

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
            enableCustomMetatag: false,
            metaTitle: null,
            metaDescription: null,
            metaImage: null,
            metaUrl: `https://${domain}/${slug}`,
            metaFavicon: "/favicon.ico",
          },
          showPoweredByBanner: false,
          showAccountCreationSlide: false,
          useAdvancedExcelViewer: false,
          useCustomAccessForm: false,
          logoOnAccessForm: false,
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
      const docFeatureFlags = await getFeatureFlags({ teamId: teamId || undefined });
      const textSelectionEnabled = docFeatureFlags.textSelection;

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
            enableCustomMetatag: link.enableCustomMetatag || false,
            metaTitle: link.metaTitle,
            metaDescription: link.metaDescription,
            metaImage: link.metaImage,
            metaFavicon: link.metaFavicon || "/favicon.ico",
            metaUrl: `https://${domain}/${slug}` || null,
          },
          showAccountCreationSlide: link.showBanner || teamPlan === "free",
          useAdvancedExcelViewer: advancedExcelEnabled,
          useCustomAccessForm:
            teamId === "cm0154tiv0000lr2t6nr5c6kp" ||
            teamId === "clup33by90000oewh4rfvp2eg" ||
            teamId === "cm76hfyvy0002q623hmen99pf" ||
            teamId === "cm9ztf0s70005js04i689gefn" ||
            teamId === "cmk2hnmqh0000k304zcoezt6n",
          logoOnAccessForm:
            teamId === "cm7nlkrhm0000qgh0nvyrrywr" ||
            teamId === "clup33by90000oewh4rfvp2eg",
          textSelectionEnabled,
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

      // Check feature flags
      const featureFlags = await getFeatureFlags({ teamId });
      const dataroomIndexEnabled = featureFlags.dataroomIndex;
      const textSelectionEnabled = featureFlags.textSelection;

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
            enableCustomMetatag: link.enableCustomMetatag || false,
            metaTitle: link.metaTitle,
            metaDescription: link.metaDescription,
            metaImage: link.metaImage,
            metaFavicon: link.metaFavicon || "/favicon.ico",
            metaUrl: `https://${domain}/${slug}` || null,
          },
          showPoweredByBanner: false,
          showAccountCreationSlide: false,
          useAdvancedExcelViewer: false, // INFO: this is managed in the API route
          useCustomAccessForm:
            teamId === "cm0154tiv0000lr2t6nr5c6kp" ||
            teamId === "clup33by90000oewh4rfvp2eg" ||
            teamId === "cm76hfyvy0002q623hmen99pf" ||
            teamId === "cm9ztf0s70005js04i689gefn" ||
            teamId === "cmk2hnmqh0000k304zcoezt6n",
          logoOnAccessForm:
            teamId === "cm7nlkrhm0000qgh0nvyrrywr" ||
            teamId === "clup33by90000oewh4rfvp2eg",
          dataroomIndexEnabled,
          textSelectionEnabled,
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

export default function ViewPage({
  frozen,
  linkData,
  notionData,
  meta,
  showAccountCreationSlide,
  useAdvancedExcelViewer,
  useCustomAccessForm,
  logoOnAccessForm,
  dataroomIndexEnabled,
  textSelectionEnabled,
  error,
}: {
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
  useCustomAccessForm: boolean;
  logoOnAccessForm: boolean;
  dataroomIndexEnabled?: boolean;
  textSelectionEnabled?: boolean;
  error?: boolean;
}) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [storedToken, setStoredToken] = useState<string | undefined>(undefined);
  const [storedEmail, setStoredEmail] = useState<string | undefined>(undefined);

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
      return (
        <NotFound message="Sorry, the link you're looking for is expired." />
      );
    }

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
          useCustomAccessForm={useCustomAccessForm}
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
      return (
        <NotFound message="Sorry, the link you're looking for is expired." />
      );
    }

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
          useCustomAccessForm={useCustomAccessForm}
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
