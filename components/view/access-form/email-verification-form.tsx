import { useEffect, useState } from "react";

import { Brand, DataroomBrand } from "@prisma/client";
import { Trans, useTranslation } from "react-i18next";

import { useMediaQuery } from "@/lib/utils/use-media-query";

import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { DEFAULT_ACCESS_FORM_TYPE } from "@/components/view/access-form";
import { createAccessFormTheme } from "@/components/view/access-form/access-form-theme";

const REGEXP_ONLY_DIGITS = "^\\d+$";

export default function EmailVerificationMessage({
  onSubmitHandler,
  isLoading,
  data,
  code,
  setCode,
  isInvalidCode,
  setIsInvalidCode,
  brand,
}: {
  onSubmitHandler: React.FormEventHandler<HTMLFormElement>;
  data: DEFAULT_ACCESS_FORM_TYPE;
  isLoading: boolean;
  code: string | null;
  setCode: (code: string | null) => void;
  isInvalidCode: boolean;
  setIsInvalidCode: (invalidCode: boolean) => void;
  brand?: Partial<Brand> | Partial<DataroomBrand> | null;
}) {
  const { isMobile } = useMediaQuery();
  const theme = createAccessFormTheme(brand?.accentColor);
  const { t } = useTranslation("access-form");
  const [isResendLoading, setIsResendLoading] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState(60);

  useEffect(() => {
    if (delaySeconds > 0) {
      const interval = setInterval(
        () => setDelaySeconds(delaySeconds - 1),
        1000,
      );

      return () => clearInterval(interval);
    }
  }, [delaySeconds]);

  return (
    <>
      <div
        className="flex h-screen flex-1 flex-col px-6 py-12 lg:px-8"
        style={{
          backgroundColor: theme.backgroundColor,
        }}
      >
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h2
            className="mt-10 text-2xl font-bold leading-9 tracking-tight"
            style={{ color: theme.textColor }}
          >
            {t("verification.title", "Verify your email address")}
          </h2>
          <p
            className="text-pretty text-sm leading-6"
            style={{ color: theme.textColor }}
          >
            <Trans
              ns="access-form"
              i18nKey="verification.description"
              values={{ email: data.email ?? "" }}
              components={{
                email: (
                  <strong className="font-medium" title={data.email ?? ""} />
                ),
              }}
            />
          </p>
          <form onSubmit={onSubmitHandler} translate="no">
            <InputOTP
              maxLength={6}
              pattern={REGEXP_ONLY_DIGITS}
              autoFocus={!isMobile}
              value={code ?? ""}
              onChange={(code) => {
                setIsInvalidCode(false);
                setCode(code || null);
              }}
              containerClassName="my-6"
              accentColor={brand?.accentColor}
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <InputOTPSlot key={index} index={index} />
                ))}
              </InputOTPGroup>
            </InputOTP>

            {isInvalidCode && (
              <p className="mb-6 mt-2 text-sm text-red-500">
                {t("verification.errorInvalid", "Invalid code. Please try again.")}
              </p>
            )}

            <Button
              type="submit"
              disabled={!code || isLoading}
              loading={isLoading && !isResendLoading}
              className="hover:opacity-90"
              style={{
                backgroundColor: theme.ctaBgColor,
                color: theme.ctaTextColor,
              }}
            >
              {isLoading && !isResendLoading
                ? t("buttons.verifying", "Verifying...")
                : t("buttons.continue", "Continue")}
            </Button>
          </form>

          <div className="mt-10 space-y-4">
            <div className="flex items-center">
              <p
                className="text-xs"
                style={{ color: theme.subtleTextColor }}
              >
                {t("verification.noEmail", "Didn't receive the email?")}
              </p>{" "}
              <Button
                variant="link"
                size="sm"
                className="text-xs font-normal"
                style={{ color: theme.mutedTextColor }}
                disabled={isLoading || delaySeconds > 0}
                onClick={(e) => {
                  e.preventDefault();
                  setIsResendLoading(true);
                  setDelaySeconds(60);
                  setCode(null);
                  setIsInvalidCode(false);
                  onSubmitHandler(
                    e as unknown as React.FormEvent<HTMLFormElement>,
                  );
                }}
              >
                {isResendLoading && !isLoading
                  ? t("verification.resending", "Resending code...")
                  : delaySeconds > 0
                    ? t("verification.resendIn", "Resend Code ({{seconds}}s)", { seconds: delaySeconds })
                    : t("verification.resend", "Resend Code")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
