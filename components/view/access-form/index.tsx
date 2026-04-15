import { useEffect, useState } from "react";

import { Brand, CustomField, DataroomBrand } from "@prisma/client";
import { ArrowUpRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import AgreementSection from "./agreement-section";
import {
  AccessFormThemeProvider,
  createAccessFormTheme,
} from "./access-form-theme";
import CustomFieldsSection from "./custom-fields-section";
import EmailSection from "./email-section";
import NameSection from "./name-section";
import PasswordSection from "./password-section";

export const DEFAULT_ACCESS_FORM_DATA = {
  email: null,
  password: null,
};

export type DEFAULT_ACCESS_FORM_TYPE = {
  email: string | null;
  password: string | null;
  hasConfirmedAgreement?: boolean;
  name?: string | null;
  customFields?: { [key: string]: string };
};

export default function AccessForm({
  data,
  email,
  brand,
  setData,
  onSubmitHandler,
  requireEmail,
  requirePassword,
  requireAgreement,
  agreementName,
  agreementContent,
  agreementContentType,
  requireName,
  isLoading,
  linkId,
  disableEditEmail,
  useCustomAccessForm,
  customFields,
  logoOnAccessForm,
  linkWelcomeMessage,
}: {
  data: DEFAULT_ACCESS_FORM_TYPE;
  email: string | null | undefined;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_ACCESS_FORM_TYPE>>;
  onSubmitHandler: React.FormEventHandler<HTMLFormElement>;
  brand?: Partial<Brand> | Partial<DataroomBrand> | null;
  requireEmail: boolean;
  requirePassword: boolean;
  requireAgreement?: boolean;
  agreementName?: string;
  agreementContent?: string;
  agreementContentType?: string;
  requireName?: boolean;
  isLoading: boolean;
  linkId?: string;
  disableEditEmail?: boolean;
  useCustomAccessForm?: boolean;
  customFields?: Partial<CustomField>[];
  logoOnAccessForm?: boolean;
  linkWelcomeMessage?: string | null;
}) {
  const [isEmailValid, setIsEmailValid] = useState(true);
  const accessFormTheme = createAccessFormTheme(brand?.accentColor);

  useEffect(() => {
    const userEmail = email;
    if (userEmail) {
      setData((prevData: DEFAULT_ACCESS_FORM_TYPE) => ({
        ...prevData,
        email: userEmail || prevData.email,
      }));
    }
  }, [email, setData]);

  const isFormValid = () => {
    if (requireEmail) {
      if (!data.email || !isEmailValid) return false;
    }
    if (requirePassword && !data.password) return false;
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
      {logoOnAccessForm && brand && brand.logo && (
        <nav
          className="w-full"
          style={{
            backgroundColor: brand.brandColor ? brand.brandColor : "black",
          }}
        >
          <div className="flex h-16 items-center justify-start px-2 sm:px-6 lg:px-8">
            <img
              src={brand.logo as string}
              alt="Brand Logo"
              className="h-16 w-auto object-contain"
            />
          </div>
        </nav>
      )}

      <div className="flex flex-1 flex-col px-6 pb-12 pt-8 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h1
            className="mt-10 text-2xl font-bold leading-9 tracking-tight text-white"
            style={{ color: accessFormTheme.textColor }}
          >
            {linkWelcomeMessage ||
              (brand && "welcomeMessage" in brand && brand.welcomeMessage) ||
              "Your action is requested to continue"}
          </h1>
        </div>

        <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-md">
          <form className="space-y-4" onSubmit={onSubmitHandler} translate="no">
            {requireAgreement && agreementContent && requireName ? (
              <NameSection {...{ data, setData, brand }} />
            ) : null}
            {requireEmail ? (
              <EmailSection
                {...{ data, setData, brand }}
                disableEditEmail={disableEditEmail}
                useCustomAccessForm={useCustomAccessForm}
                onValidationChange={setIsEmailValid}
              />
            ) : null}
            {requirePassword ? (
              <PasswordSection {...{ data, setData, brand }} />
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
                agreementContent={agreementContent}
                agreementName={agreementName}
                agreementContentType={agreementContentType}
                useCustomAccessForm={useCustomAccessForm}
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
                Continue
              </Button>
            </div>
          </form>
        </div>
      </div>
      {!useCustomAccessForm ? (
        <div className="flex flex-col items-center gap-0.5">
          <p
            className="text-center text-sm tracking-tight"
            style={{ color: accessFormTheme.subtleTextColor }}
          >
            This document is securely shared with you using{" "}
            <a
              href="https://www.papermark.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium"
              style={{ color: accessFormTheme.mutedTextColor }}
            >
              Papermark
            </a>
            .
          </p>
          <p
            className="text-center text-sm tracking-tight"
            style={{ color: accessFormTheme.subtleTextColor }}
          >
            See how we protect your data in our{" "}
            <a
              href="https://www.papermark.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5"
              style={{ color: accessFormTheme.mutedTextColor }}
            >
              <span>Privacy Policy</span>
              <ArrowUpRightIcon className="h-3 w-3" />
            </a>
          </p>
        </div>
      ) : null}
      </div>
    </AccessFormThemeProvider>
  );
}
