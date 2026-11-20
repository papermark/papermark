import { useRouter } from "next/router";

import { useEffect, useState } from "react";

import { useAnalytics } from "@/lib/analytics";
import { useUrlPasscode } from "@/lib/hooks/use-url-passcode";

import LoadingSpinner from "@/components/ui/loading-spinner";
import DataroomView from "@/components/view/dataroom/dataroom-view";
import DocumentView from "@/components/view/document-view";
import { ViewerI18nProvider } from "@/components/view/viewer-i18n-provider";
import { ViewerNotFound } from "@/components/view/viewer-not-found";

import { ViewPageProps } from "./index";

// Reuse the same getStaticProps and getStaticPaths from the main view page
export { getStaticProps, getStaticPaths } from "./index";

function EmbedPageInner(props: ViewPageProps) {
  const router = useRouter();
  const [isEmbedded, setIsEmbedded] = useState<boolean | null>(null);
  const analytics = useAnalytics();
  const urlPasscode = useUrlPasscode();

  useEffect(() => {
    // Only run when router is ready and linkId is present
    if (!router.isReady || !router.query.linkId) return;

    // Check if the page is embedded in an iframe
    const isInIframe = window !== window.parent;
    setIsEmbedded(isInIframe);

    if (isInIframe) {
      document.body.classList.add("embed-view");

      // Track embed view with referrer information
      const referrer = document.referrer;
      const embedSource = referrer ? new URL(referrer).hostname : "direct";

      analytics.capture("Embedded Link Loaded", {
        linkId: router.query.linkId as string,
        embedSource,
        url: referrer || "unknown",
        userAgent: window.navigator.userAgent,
      });

      return () => document.body.classList.remove("embed-view");
    }
  }, [router.isReady, router.query.linkId]);

  // Show loading state while checking
  if (isEmbedded === null || router.isFallback) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner className="h-20 w-20" />
      </div>
    );
  }

  // Block direct access
  if (!isEmbedded) {
    return <ViewerNotFound reason="embedOnly" />;
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
  const { linkType, brand } = props.linkData;

  // Render the document view for DOCUMENT_LINK
  if (linkType === "DOCUMENT_LINK") {
    const { link } = props.linkData;
    if (!props.linkData || router.isFallback) {
      return (
        <div className="flex h-screen items-center justify-center">
          <LoadingSpinner className="h-20 w-20" />
        </div>
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

    // If the link is expired, show a 404 page
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
          showPoweredByBanner={props.showPoweredByBanner}
          showAccountCreationSlide={props.showAccountCreationSlide}
          useAdvancedExcelViewer={props.useAdvancedExcelViewer}
          previewToken={previewToken}
          disableEditEmail={!!disableEditEmail}
          urlPasscode={urlPasscode}
          disableEditPassword={disableEditPassword}
          hideFooterOnAccessForm={props.hideFooterOnAccessForm}
          verifiedEmail={verifiedEmail}
          isEmbedded
        />
      </div>
    );
  }

  // Render the dataroom view for DATAROOM_LINK
  if (linkType === "DATAROOM_LINK") {
    const { link } = props.linkData;
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
      emailAuthenticated,
      password: linkPassword,
      enableAgreement,
      isArchived,
    } = link;

    // If the link is expired, show a 404 page
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
          verifiedEmail={verifiedEmail}
          isEmbedded
        />
      </div>
    );
  }
}

export default function EmbedPage(props: ViewPageProps) {
  const locale = props.i18n?.locale ?? "en";
  const resources = props.i18n?.resources ?? {};
  return (
    <ViewerI18nProvider locale={locale} resources={resources}>
      <EmbedPageInner {...props} />
    </ViewerI18nProvider>
  );
}
