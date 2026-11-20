import { useRouter } from "next/router";

import { useEffect, useState } from "react";

import { Brand, DataroomBrand } from "@prisma/client";

import { useAnalytics } from "@/lib/analytics";
import { useUrlPasscode } from "@/lib/hooks/use-url-passcode";
import { type ViewerI18nPageProps } from "@/lib/i18n/viewer-page-props";
import { LinkWithDataroom, LinkWithDocument } from "@/lib/types";

import LoadingSpinner from "@/components/ui/loading-spinner";
import DataroomView from "@/components/view/dataroom/dataroom-view";
import DocumentView from "@/components/view/document-view";
import { ViewerI18nProvider } from "@/components/view/viewer-i18n-provider";
import { ViewerNotFound } from "@/components/view/viewer-not-found";

// Reuse the same getStaticProps and getStaticPaths from the main domain view page
export { getStaticProps, getStaticPaths } from "./index";

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

type DomainEmbedPageProps = Partial<ViewerI18nPageProps> & {
  frozen?: boolean;
  error?: boolean;
  linkData: DocumentLinkData | DataroomLinkData | { linkType: string };
  notionData: {
    rootNotionPageId: string | null;
    recordMap: any;
    theme: any;
  };
  showAccountCreationSlide?: boolean;
  useAdvancedExcelViewer?: boolean;
  hideFooterOnAccessForm?: boolean;
  logoOnAccessForm?: boolean;
  textSelectionEnabled?: boolean;
};

function EmbedPageInner(props: DomainEmbedPageProps) {
  const router = useRouter();
  const [isEmbedded, setIsEmbedded] = useState<boolean | null>(null);
  const analytics = useAnalytics();
  const urlPasscode = useUrlPasscode();

  useEffect(() => {
    if (!router.isReady || !router.query.slug) return;

    const isInIframe = window !== window.parent;
    setIsEmbedded(isInIframe);

    if (isInIframe) {
      document.body.classList.add("embed-view");

      const referrer = document.referrer;
      const embedSource = referrer ? new URL(referrer).hostname : "direct";

      analytics.capture("Embedded Link Loaded", {
        domain: router.query.domain as string,
        slug: router.query.slug as string,
        embedSource,
        url: referrer || "unknown",
        userAgent: window.navigator.userAgent,
      });

      return () => document.body.classList.remove("embed-view");
    }
  }, [router.isReady, router.query.slug, router.query.domain]);

  if (isEmbedded === null || router.isFallback) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner className="h-20 w-20" />
      </div>
    );
  }

  if (!isEmbedded) {
    return <ViewerNotFound reason="embedOnly" />;
  }

  if (props.frozen) {
    return <ViewerNotFound reason="dataroomClosed" />;
  }

  if (props.error) {
    return <ViewerNotFound reason="loadErrorRetry" />;
  }

  const {
    email: verifiedEmail,
    d: disableEditEmail,
    previewToken,
  } = router.query as {
    email: string;
    d: string;
    previewToken?: string;
  };
  const disableEditPassword = !!disableEditEmail && !!urlPasscode;

  const { linkType } = props.linkData;

  if (linkType === "DOCUMENT_LINK") {
    const { link, brand } = props.linkData as DocumentLinkData;
    if (!link || router.isFallback) {
      return (
        <div className="flex h-screen items-center justify-center">
          <LoadingSpinner className="h-20 w-20" />
        </div>
      );
    }

    const {
      expiresAt,
      emailProtected,
      password: linkPassword,
      enableAgreement,
      isArchived,
    } = link;

    if (expiresAt && new Date(expiresAt) < new Date()) {
      return <ViewerNotFound reason="expired" />;
    }

    if (isArchived) {
      return <ViewerNotFound reason="archived" />;
    }

    return (
      <div className="h-screen w-full overflow-hidden">
        <DocumentView
          link={link}
          userEmail={verifiedEmail}
          userId={null}
          isProtected={!!(emailProtected || linkPassword || enableAgreement)}
          notionData={props.notionData}
          brand={brand}
          showAccountCreationSlide={props.showAccountCreationSlide}
          useAdvancedExcelViewer={props.useAdvancedExcelViewer}
          previewToken={previewToken}
          disableEditEmail={!!disableEditEmail}
          urlPasscode={urlPasscode}
          disableEditPassword={disableEditPassword}
          hideFooterOnAccessForm={props.hideFooterOnAccessForm}
          logoOnAccessForm={props.logoOnAccessForm}
          verifiedEmail={verifiedEmail}
          textSelectionEnabled={props.textSelectionEnabled}
          isEmbedded
        />
      </div>
    );
  }

  if (linkType === "DATAROOM_LINK") {
    const { link, brand } = props.linkData as DataroomLinkData;
    if (!link || router.isFallback) {
      return (
        <div className="flex h-screen items-center justify-center">
          <LoadingSpinner className="h-20 w-20" />
        </div>
      );
    }

    const {
      expiresAt,
      emailProtected,
      password: linkPassword,
      enableAgreement,
      isArchived,
    } = link;

    if (expiresAt && new Date(expiresAt) < new Date()) {
      return <ViewerNotFound reason="expired" />;
    }

    if (isArchived) {
      return <ViewerNotFound reason="archived" />;
    }

    return (
      <div className="h-screen w-full overflow-hidden">
        <DataroomView
          link={link}
          userEmail={verifiedEmail}
          userId={null}
          isProtected={!!(emailProtected || linkPassword || enableAgreement)}
          brand={brand}
          previewToken={previewToken}
          disableEditEmail={!!disableEditEmail}
          urlPasscode={urlPasscode}
          disableEditPassword={disableEditPassword}
          hideFooterOnAccessForm={props.hideFooterOnAccessForm}
          logoOnAccessForm={props.logoOnAccessForm}
          verifiedEmail={verifiedEmail}
          textSelectionEnabled={props.textSelectionEnabled}
          isEmbedded
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <LoadingSpinner className="h-20 w-20" />
    </div>
  );
}

export default function EmbedPage(props: DomainEmbedPageProps) {
  const locale = props.i18n?.locale ?? "en";
  const resources = props.i18n?.resources ?? {};
  return (
    <ViewerI18nProvider locale={locale} resources={resources}>
      <EmbedPageInner {...props} />
    </ViewerI18nProvider>
  );
}
