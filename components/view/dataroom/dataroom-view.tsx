import { useRouter } from "next/router";

import React, { useEffect, useRef, useState } from "react";

import { DataroomBrand } from "@prisma/client";
import Cookies from "js-cookie";
import { toast } from "sonner";

import { PendingUploadsProvider } from "@/context/pending-uploads-context";
import { useAnalytics } from "@/lib/analytics";
import { SUPPORTED_DOCUMENT_SIMPLE_TYPES } from "@/lib/constants";
import { useDisablePrint } from "@/lib/hooks/use-disable-print";
import { LinkWithDataroom } from "@/lib/types";

import LoadingSpinner from "@/components/ui/loading-spinner";
import AccessForm, {
  DEFAULT_ACCESS_FORM_DATA,
  DEFAULT_ACCESS_FORM_TYPE,
} from "@/components/view/access-form";

import EmailVerificationMessage from "../access-form/email-verification-form";
import DataroomViewer from "../viewer/dataroom-viewer";

export type TSupportedDocumentSimpleType =
  (typeof SUPPORTED_DOCUMENT_SIMPLE_TYPES)[number];

export type TDocumentData = {
  id: string;
  name: string;
  hasPages: boolean;
  documentType: TSupportedDocumentSimpleType;
  documentVersionId: string;
  documentVersionNumber: number;
  downloadOnly: boolean;
  isVertical?: boolean;
};

export type DEFAULT_DATAROOM_VIEW_TYPE = {
  viewId?: string;
  isPreview?: boolean;
  verificationToken?: string;
  viewerEmail?: string;
  viewerId?: string;
  conversationsEnabled?: boolean;
  enableVisitorUpload?: boolean;
  /**
   * When the link restricts uploads to specific folders this is the ordered
   * allow-list. `null`/`undefined` means "no restriction — visitor may upload
   * into whichever folder they're currently browsing".
   */
  uploadFolderAllowList?:
    | { id: string; name: string; path: string }[]
    | null;
  isTeamMember?: boolean;
  agentsEnabled?: boolean;
  dataroomName?: string;
};

export default function DataroomView({
  link,
  userEmail,
  userId,
  isProtected,
  brand,
  token,
  verifiedEmail,
  previewToken,
  disableEditEmail,
  useCustomAccessForm,
  logoOnAccessForm,
  isEmbedded,
  preview,
  dataroomIndexEnabled,
  textSelectionEnabled,
}: {
  link: LinkWithDataroom;
  userEmail: string | null | undefined;
  userId: string | null | undefined;
  isProtected: boolean;
  brand?: Partial<DataroomBrand> | null;
  token?: string;
  verifiedEmail?: string;
  previewToken?: string;
  disableEditEmail?: boolean;
  useCustomAccessForm?: boolean;
  isEmbedded?: boolean;
  preview?: boolean;
  logoOnAccessForm?: boolean;
  dataroomIndexEnabled?: boolean;
  textSelectionEnabled?: boolean;
}) {
  useDisablePrint();
  const {
    linkType,
    dataroom,
    emailProtected,
    password: linkPassword,
    enableAgreement,
    group,
  } = link;

  const analytics = useAnalytics();
  const router = useRouter();
  const [folderId, setFolderId] = useState<string | null>(null);

  const didMount = useRef<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [viewData, setViewData] = useState<DEFAULT_DATAROOM_VIEW_TYPE>({
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
  const shouldApplyAccentToDataroomView = !!(brand as any)
    ?.applyAccentColorToDataroomView;
  const dataroomViewBackgroundColor = shouldApplyAccentToDataroomView
    ? brand?.accentColor
    : "#ffffff";

  const handleSubmission = async (): Promise<void> => {
    setIsLoading(true);
    const response = await fetch("/api/views-dataroom", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...data,
        email: data.email ?? verifiedEmail ?? userEmail ?? null,
        linkId: link.id,
        userId: userId ?? null,
        dataroomId: dataroom?.id,
        linkType: "DATAROOM_LINK",
        viewType: "DATAROOM_VIEW",
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
          dataroomId: dataroom?.id,
          dataroomName: dataroom?.name,
          linkType: "DATAROOM_LINK",
          viewerEmail: data.email ?? verifiedEmail ?? userEmail,
          teamId: link.teamId,
        });
        setVerificationRequested(true);
        setIsLoading(false);
      } else {
        const {
          viewId,
          isPreview,
          verificationToken,
          viewerEmail,
          viewerId,
          conversationsEnabled,
          enableVisitorUpload,
          uploadFolderAllowList,
          isTeamMember,
          agentsEnabled,
          dataroomName,
        } = fetchData as DEFAULT_DATAROOM_VIEW_TYPE;

        analytics.identify(
          userEmail ?? viewerEmail ?? verifiedEmail ?? data.email ?? undefined,
        );
        analytics.capture("Link Viewed", {
          linkId: link.id,
          dataroomId: dataroom?.id,
          linkType: linkType,
          viewerId: viewerId,
          viewerEmail: viewerEmail ?? data.email ?? verifiedEmail ?? userEmail,
          isEmbedded,
          isTeamMember,
          teamId: link.teamId,
        });

        // set the verification token to the cookie
        if (verificationToken) {
          // Cookies.set("pm_vft", verificationToken, {
          //   path: router.asPath.split("?")[0],
          //   expires: 1,
          //   sameSite: "strict",
          //   secure: true,
          // });
          setCode(null);
        }

        setViewData({
          viewId,
          isPreview,
          viewerEmail,
          viewerId,
          conversationsEnabled,
          enableVisitorUpload,
          uploadFolderAllowList,
          isTeamMember,
          agentsEnabled,
          dataroomName,
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
      if ((!submitted && !isProtected) || token || preview || previewToken) {
        handleSubmission();
        didMount.current = true;
      }
    }
  }, [submitted, isProtected, token, preview, previewToken]);

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
        disableEditEmail={disableEditEmail}
        useCustomAccessForm={useCustomAccessForm}
        brand={brand}
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

  if (submitted) {
    return (
      <PendingUploadsProvider
          linkId={viewData.enableVisitorUpload ? link.id : undefined}
          dataroomId={viewData.enableVisitorUpload ? dataroom?.id : undefined}
        >
        <div
          className="min-h-screen bg-white"
          style={{ backgroundColor: dataroomViewBackgroundColor ?? undefined }}
        >
          <DataroomViewer
            accessControls={link.accessControls || group?.accessControls || []}
            brand={brand!}
            viewId={viewData.viewId}
            isPreview={viewData.isPreview}
            linkId={link.id}
            dataroom={dataroom}
            allowDownload={link.allowDownload!}
            enableIndexFile={link.enableIndexFile}
            folderId={folderId}
            setFolderId={setFolderId}
            viewerId={viewData.viewerId}
            viewData={viewData}
            isEmbedded={isEmbedded}
            dataroomIndexEnabled={dataroomIndexEnabled}
            viewerEmail={
              viewData.viewerEmail ??
              data.email ??
              verifiedEmail ??
              userEmail ??
              undefined
            }
          />
        </div>
      </PendingUploadsProvider>
    );
  }

  return (
    <div
      className="min-h-screen bg-white"
      style={{ backgroundColor: dataroomViewBackgroundColor ?? undefined }}
    >
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner className="h-20 w-20" />
      </div>
    </div>
  );
}
