import { useEffect, useMemo, useState } from "react";

import { resolveBrandLogo } from "@/ee/features/branding/lib/brand-logo";
import { Brand, CustomField, DataroomBrand, LinkType } from "@prisma/client";
import { ArrowUpRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { stripTrailingPasswordWhitespace } from "@/lib/utils";

import { Button } from "@/components/ui/button";

import {
  AccessFormThemeProvider,
  createAccessFormTheme,
} from "./access-form-theme";
import AgreementSection from "./agreement-section";
import CustomFieldsSection from "./custom-fields-section";
import EmailSection from "./email-section";
import NameSection from "./name-section";
import PasswordSection from "./password-section";

export const DEFAULT_ACCESS_FORM_DATA = {
  email: null,
  password: null,
  agreementResponseId: null,
};

export type DEFAULT_ACCESS_FORM_TYPE = {
  email: string | null;
  password: string | null;
  hasConfirmedAgreement?: boolean;
  agreementResponseId?: string | null;
  agreementStatus?: string | null;
  name?: string | null;
  customFields?: { [key: string]: string };
};

export default function AccessForm({
  data,
  email,
  password,
  brand,
  setData,
  onSubmitHandler,
  requireEmail,
  requirePassword,
  requireAgreement,
  agreementId,
  agreementName,
  agreementContent,
  agreementContentType,
  signingProvider,
  requireName,
  isLoading,
  linkId,
  disableEditEmail,
  disableEditPassword,
  hideFooterOnAccessForm,
  linkType,
  customFields,
  logoOnAccessForm,
  linkWelcomeMessage,
}: {
  data: DEFAULT_ACCESS_FORM_TYPE;
  email: string | null | undefined;
  password?: string | null | undefined;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_ACCESS_FORM_TYPE>>;
  onSubmitHandler: React.FormEventHandler<HTMLFormElement>;
  brand?: Partial<Brand> | Partial<DataroomBrand> | null;
  requireEmail: boolean;
  requirePassword: boolean;
  requireAgreement?: boolean;
  agreementId?: string;
  agreementName?: string;
  agreementContent?: string;
  agreementContentType?: string;
  signingProvider?: string;
  requireName?: boolean;
  isLoading: boolean;
  linkId?: string;
  disableEditEmail?: boolean;
  disableEditPassword?: boolean;
  hideFooterOnAccessForm?: boolean;
  linkType?: LinkType;
  customFields?: Partial<CustomField>[];
  logoOnAccessForm?: boolean;
  linkWelcomeMessage?: string | null;
}) {
  const [isEmailValid, setIsEmailValid] = useState(true);
  // Memoize the palette: expensive to compute and a new identity re-renders every theme consumer.
  const accessFormTheme = useMemo(
    () => createAccessFormTheme(brand?.accentColor),
    [brand?.accentColor],
  );
  const { t } = useTranslation("access-form");
  const resolvedBrandLogo = resolveBrandLogo(brand);

  // The server only leaves this set when the override actually applies.
  const customPrivacyPolicyUrl =
    brand && "privacyPolicyUrl" in brand ? brand.privacyPolicyUrl : null;
  const privacyPolicyUrl =
    customPrivacyPolicyUrl ||
    `${process.env.NEXT_PUBLIC_MARKETING_URL}/privacy`;

  const isSigningAgreement =
    signingProvider === "DOCUMENSO" || agreementContentType === "SIGNING";
  const isAgreementLocked = Boolean(
    requireAgreement && isSigningAgreement && data.hasConfirmedAgreement,
  );
  const lockEmailField = Boolean(disableEditEmail) || isAgreementLocked;
  const lockNameField = isAgreementLocked;
  const lockPasswordField = Boolean(disableEditPassword);

  useEffect(() => {
    const userEmail = email;
    if (userEmail) {
      setData((prevData: DEFAULT_ACCESS_FORM_TYPE) => ({
        ...prevData,
        email: userEmail || prevData.email,
      }));
    }
  }, [email, setData]);

  // Prefill the passcode from a link param (e.g. ?passcode=...) so it can be
  // shared alongside the email. Only seed when the field is still empty to
  // preserve any edits the viewer makes.
  useEffect(() => {
    if (password) {
      setData((prevData: DEFAULT_ACCESS_FORM_TYPE) => ({
        ...prevData,
        password: prevData.password ?? password,
      }));
    }
  }, [password, setData]);

  const isFormValid = () => {
    if (requireEmail) {
      if (!data.email || !isEmailValid) return false;
    }
    if (
      requirePassword &&
      !stripTrailingPasswordWhitespace(data.password ?? "")
    ) {
      return false;
    }
    if (requireAgreement && !data.hasConfirmedAgreement) return false;
    if (requireAgreement && requireName && !data.name) return false;
    if (customFields?.length) {
      for (const field of customFields) {
        if (field.required) {
          const fieldValue = data.customFields?.[field.identifier!];
          // For checkbox fields, required means it must be checked (true)
          if (field.type === "CHECKBOX") {
            if (fieldValue !== "true") {
              return false;
            }
          } else {
            // For other field types, required means it must have a value
            if (!fieldValue) {
              return false;
            }
          }
        }
      }
    }
    return true;
  };

  const updateCustomFields = (fields: { [key: string]: string }) => {
    setData((prevData) => ({
      ...prevData,
      customFields: fields,
    }));
  };

  return (
    <AccessFormThemeProvider value={accessFormTheme}>
      <div
        className="flex h-full min-h-dvh flex-col justify-between pb-4"
        style={{
          backgroundColor: accessFormTheme.backgroundColor,
          color: accessFormTheme.textColor,
        }}
      >
        {/* Light Navbar */}
        {logoOnAccessForm && resolvedBrandLogo.kind === "custom" ? (
          <nav
            className="w-full"
            style={{
              backgroundColor: brand?.brandColor || "black",
            }}
          >
            <div className="flex h-16 items-center justify-start px-2 sm:px-6 lg:px-8">
              <img
                src={resolvedBrandLogo.src}
                alt="Brand Logo"
                className="h-16 w-auto object-contain"
              />
            </div>
          </nav>
        ) : null}

        <div className="flex flex-1 flex-col px-6 pb-12 pt-8 lg:px-8">
          <div className="sm:mx-auto sm:w-full sm:max-w-md">
            <h1
              className="mt-10 text-2xl font-bold leading-9 tracking-tight text-white"
              style={{ color: accessFormTheme.textColor }}
            >
              {linkWelcomeMessage ||
                (brand && "welcomeMessage" in brand && brand.welcomeMessage) ||
                t("welcome.fallback", "Your action is requested to continue")}
            </h1>
          </div>

          <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-md">
            <form
              className="space-y-4"
              onSubmit={onSubmitHandler}
              translate="no"
            >
              {requireAgreement && agreementContent && requireName ? (
                <NameSection
                  {...{ data, setData, brand }}
                  disableEditName={lockNameField}
                />
              ) : null}
              {requireEmail ? (
                <EmailSection
                  {...{ data, setData, brand }}
                  disableEditEmail={lockEmailField}
                  hideFooterOnAccessForm={hideFooterOnAccessForm}
                  onValidationChange={setIsEmailValid}
                />
              ) : null}
              {requirePassword ? (
                <PasswordSection
                  {...{ data, setData, brand }}
                  disableEditPassword={lockPasswordField}
                />
              ) : null}
              {customFields?.length ? (
                <CustomFieldsSection
                  fields={customFields}
                  data={data.customFields || {}}
                  setData={updateCustomFields}
                  brand={brand}
                />
              ) : null}
              {requireAgreement && agreementContent && agreementName ? (
                <AgreementSection
                  {...{ data, setData, brand }}
                  agreementId={agreementId}
                  agreementContent={agreementContent}
                  agreementName={agreementName}
                  agreementContentType={agreementContentType}
                  signingProvider={signingProvider}
                  linkId={linkId}
                  requireEmail={requireEmail}
                  requireName={requireName}
                  hideFooterOnAccessForm={hideFooterOnAccessForm}
                />
              ) : null}

              <div className="flex justify-center pt-5">
                <Button
                  type="submit"
                  disabled={!isFormValid()}
                  className="w-1/3 min-w-fit bg-white text-gray-950 hover:bg-white/90"
                  loading={isLoading}
                  style={{
                    backgroundColor: accessFormTheme.ctaBgColor,
                    color: accessFormTheme.ctaTextColor,
                  }}
                >
                  {t("buttons.continue", "Continue")}
                </Button>
              </div>
            </form>
          </div>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          {!hideFooterOnAccessForm ? (
            <p
              className="text-center text-sm tracking-tight"
              style={{ color: accessFormTheme.subtleTextColor }}
            >
              {linkType === "DATAROOM_LINK"
                ? t(
                    "footer.sharedSecurelyViaDataroom",
                    "This data room is securely shared with you using",
                  )
                : t(
                    "footer.sharedSecurelyVia",
                    "This document is securely shared with you using",
                  )}{" "}
              <a
                href="https://www.papermark.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium"
                style={{ color: accessFormTheme.mutedTextColor }}
              >
                {t("footer.papermark", "Papermark")}
              </a>
              .
            </p>
          ) : null}
          <p
            className="text-center text-sm tracking-tight"
            style={{ color: accessFormTheme.subtleTextColor }}
          >
            {t("footer.seeHowWeProtect", "See how we protect your data in our")}{" "}
            <a
              href={privacyPolicyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5"
              style={{ color: accessFormTheme.mutedTextColor }}
            >
              <span>{t("footer.privacyPolicy", "Privacy Policy")}</span>
              <ArrowUpRightIcon className="h-3 w-3" />
            </a>
          </p>
        </div>
      </div>
    </AccessFormThemeProvider>
  );
}
