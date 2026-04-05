import { useRouter } from "next/router";

import React, { useEffect, useRef, useState } from "react";

import { Brand } from "@prisma/client";
import Cookies from "js-cookie";
import { ExtendedRecordMap } from "notion-types";
import { toast } from "sonner";

import { useAnalytics } from "@/lib/analytics";
import { useDisablePrint } from "@/lib/hooks/use-disable-print";
import { LinkWithDocument, NotionTheme } from "@/lib/types";

import LoadingSpinner from "@/components/ui/loading-spinner";
import AccessForm, {
  DEFAULT_ACCESS_FORM_DATA,
  DEFAULT_ACCESS_FORM_TYPE,
} from "@/components/view/access-form";

import EmailVerificationMessage from "./access-form/email-verification-form";
import ViewData, { TViewDocumentData } from "./view-data";

type RowData = { [key: string]: any };
type SheetData = {
  sheetName: string;
  columnData: string[];
  rowData: RowData[];
};

export type DEFAULT_DOCUMENT_VIEW_TYPE = {
  viewId?: string;
  file?: string | null;
  pages?:
    | {
        file: string | null;
        pageNumber: string;
        embeddedLinks: string[];
        pageLinks: {
          href: string;
          coords: string;
          isInternal?: boolean;
          targetPage?: number;
        }[];
        metadata: { width: number; height: number; scaleFactor: number };
      }[]
    | null;
  sheetData?: SheetData[] | null;
  fileType?: string;
  isPreview?: boolean;
  ipAddress?: string;
  verificationToken?: string;
  isTeamMember?: boolean;
  agentsEnabled?: boolean;
  viewerId?: string;
};

export default function DocumentView({
  link,
  userEmail,
  userId,
  isProtected,
  notionData,
  brand,
  token,
  verifiedEmail,
  showPoweredByBanner,
  showAccountCreationSlide,
  useAdvancedExcelViewer,
  previewToken,
  disableEditEmail,
  useCustomAccessForm,
  logoOnAccessForm,
  isEmbedded,
  annotationsEnabled,
  textSelectionEnabled,
}: {
  link: LinkWithDocument;
  userEmail: string | null | undefined;
  userId: string | null | undefined;
  isProtected: boolean;
  notionData?: {
    rootNotionPageId: string | null;
    recordMap: ExtendedRecordMap | null;
    theme: NotionTheme | null;
  };
  brand?: Partial<Brand> | null;
  token?: string;
  verifiedEmail?: string;
  showPoweredByBanner?: boolean;
  showAccountCreationSlide?: boolean;
  useAdvancedExcelViewer?: boolean;
  previewToken?: string;
  disableEditEmail?: boolean;
  useCustomAccessForm?: boolean;
  isEmbedded?: boolean;
  logoOnAccessForm?: boolean;
  annotationsEnabled?: boolean;
  textSelectionEnabled?: boolean;
}) {
  useDisablePrint();
  const {
    document,
    emailProtected,
    password: linkPassword,
    enableAgreement,
  } = link;

  const analytics = useAnalytics();
  const router = useRouter();

  const didMount = useRef<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [viewData, setViewData] = useState<DEFAULT_DOCUMENT_VIEW_TYPE>({
    viewId: "",
  });
  const [data, setData] = useState<DEFAULT_ACCESS_FORM_TYPE>(
    DEFAULT_ACCESS_FORM_DATA,
  );
  const [verificationRequested, setVerificationRequested] =
    useState<boolean>(false);
  const [verificationToken, setVerificationToken] = useState<string | null>(
    token ?? null,
  );
  const [code, setCode] = useState<string | null>(null);
  const [isInvalidCode, setIsInvalidCode] = useState<boolean>(false);

  const handleSubmission = async (): Promise<void> => {
    setIsLoading(true);
    const response = await fetch("/api/views", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...data,
        email: data.email ?? verifiedEmail ?? userEmail ?? null,
        linkId: link.id,
        documentId: document.id,
        documentName: document.name,
        ownerId: document.ownerId,
        userId: userId ?? null,
        documentVersionId: document.versions[0].id,
        hasPages: document.versions[0].hasPages,
        startPage: router.query.p ? Number(router.query.p) : undefined,
        useAdvancedExcelViewer,
        previewToken,
        code: code ?? undefined,
        token: verificationToken ?? undefined,
        verifiedEmail: verifiedEmail ?? undefined,
      }),
    });

    if (response.ok) {
      const fetchData = await response.json();

      if (fetchData.type === "email-verification") {
        analytics.capture("Email Verification Requested", {
          linkId: link.id,
          documentId: document.id,
          documentName: document.name,
          linkType: "DOCUMENT_LINK",
          viewerEmail: data.email ?? verifiedEmail ?? userEmail,
          teamId: link.teamId,
        });
        setVerificationRequested(true);
        setIsLoading(false);
      } else {
        const {
          viewId,
          viewerId,
          file,
          pages,
          sheetData,
          fileType,
          isPreview,
          ipAddress,
          verificationToken,
          agentsEnabled,
          isTeamMember,
          viewerId,
        } = fetchData as DEFAULT_DOCUMENT_VIEW_TYPE;

        analytics.identify(
          userEmail ?? verifiedEmail ?? data.email ?? undefined,
        );
        analytics.capture("Link Viewed", {
          linkId: link.id,
          documentId: document.id,
          linkType: "DOCUMENT_LINK",
          viewerId: viewId,
          viewerEmail: data.email ?? verifiedEmail ?? userEmail,
          isEmbedded,
          isTeamMember,
          teamId: link.teamId,
        });

        // set the verification token to the cookie
        if (verificationToken) {
          Cookies.set("pm_vft", verificationToken, {
            path: router.asPath.split("?")[0],
            expires: 1,
            sameSite: "strict",
            secure: true,
          });
          setCode(null);
        }

        setViewData({
          viewId,
          viewerId,
          file,
          pages,
          sheetData,
          fileType,
          isPreview,
          ipAddress,
          isTeamMember,
          agentsEnabled,
          viewerId,
        });
        setSubmitted(true);
        setVerificationRequested(false);
        setIsLoading(false);
      }
    } else {
      const data = await response.json();
      toast.error(data.message);

      if (data.resetVerification) {
        const currentPath = router.asPath.split("?")[0];

        Cookies.remove("pm_vft", { path: currentPath });
        setVerificationToken(null);
        setCode(null);
        setIsInvalidCode(true);
      }
      setIsLoading(false);
    }
  };

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event: React.FormEvent,
  ): Promise<void> => {
    event.preventDefault();
    await handleSubmission();
  };

  // If token is present, run handle submit which will verify token and get document
  // If link is not submitted and does not have email / password protection, show the access form
  useEffect(() => {
    if (!didMount.current) {
      if ((!submitted && !isProtected) || token || previewToken) {
        handleSubmission();
      }
      didMount.current = true;
    }
  }, [submitted, isProtected, token, previewToken]);

  // Components to render when email is submitted but verification is pending
  if (verificationRequested) {
    return (
      <EmailVerificationMessage
        onSubmitHandler={handleSubmit}
        data={data}
        isLoading={isLoading}
        code={code}
        setCode={setCode}
        isInvalidCode={isInvalidCode}
        setIsInvalidCode={setIsInvalidCode}
        brand={brand}
      />
    );
  }

  // If link is not submitted and does not have email / password protection, show the access form
  if (!submitted && isProtected) {
    return (
      <AccessForm
        data={data}
        email={userEmail}
        setData={setData}
        onSubmitHandler={handleSubmit}
        requireEmail={emailProtected}
        requirePassword={!!linkPassword}
        requireAgreement={enableAgreement!}
        agreementName={link.agreement?.name}
        agreementContent={link.agreement?.content}
        agreementContentType={link.agreement?.contentType}
        requireName={link.agreement?.requireName}
        isLoading={isLoading}
        brand={brand}
        disableEditEmail={disableEditEmail}
        useCustomAccessForm={useCustomAccessForm}
        customFields={link.customFields}
        logoOnAccessForm={logoOnAccessForm}
        linkWelcomeMessage={link.welcomeMessage}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner className="h-20 w-20" />
      </div>
    );
  }

  return (
    <div
      className="bg-gray-950"
      style={{
        backgroundColor:
          brand && brand.accentColor ? brand.accentColor : "rgb(3, 7, 18)",
      }}
    >
      {submitted ? (
        <ViewData
          link={link}
          viewData={viewData}
          document={document as unknown as TViewDocumentData}
          notionData={notionData}
          brand={brand}
          showPoweredByBanner={showPoweredByBanner}
          showAccountCreationSlide={showAccountCreationSlide}
          useAdvancedExcelViewer={useAdvancedExcelViewer}
          viewerEmail={data.email ?? verifiedEmail ?? userEmail ?? undefined}
          annotationsEnabled={annotationsEnabled}
          textSelectionEnabled={textSelectionEnabled}
        />
      ) : (
        <div className="flex h-screen items-center justify-center">
          <LoadingSpinner className="h-20 w-20" />
        </div>
      )}
    </div>
  );
}
