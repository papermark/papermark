import {
  type CSSProperties,
  Dispatch,
  SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

import { Brand, DataroomBrand } from "@prisma/client";
import { useTranslation } from "react-i18next";
import { useDebouncedCallback } from "use-debounce";

import { cn } from "@/lib/utils";
import { validateEmail } from "@/lib/utils/validate-email";

import { DEFAULT_ACCESS_FORM_TYPE } from ".";
import { useAccessFormTheme } from "./access-form-theme";

export default function EmailSection({
  data,
  setData,
  brand,
  disableEditEmail,
  hideFooterOnAccessForm,
  onValidationChange,
}: {
  data: DEFAULT_ACCESS_FORM_TYPE;
  setData: Dispatch<SetStateAction<DEFAULT_ACCESS_FORM_TYPE>>;
  brand?: Partial<Brand> | Partial<DataroomBrand> | null;
  disableEditEmail?: boolean;
  hideFooterOnAccessForm?: boolean;
  onValidationChange: (isValid: boolean) => void;
}) {
  const { email } = data;
  const theme = useAccessFormTheme();
  const { t } = useTranslation("access-form");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (disableEditEmail) {
      return;
    }

    // Load email from localStorage when the component mounts
    const storedEmail = window.localStorage.getItem("papermark.email");
    if (storedEmail) {
      setData((prevData) => ({
        ...prevData,
        email: prevData.email ?? storedEmail.toLowerCase(),
      }));
    }
  }, [disableEditEmail, setData]);

  const handleInvalid = (e: React.InvalidEvent<HTMLInputElement>) => {
    e.preventDefault(); // Prevent default browser validation popup
    setEmailError(t("fields.email.errorInvalid", "Please enter a valid email address"));
  };

  const debouncedValidation = useDebouncedCallback(
    (value: string) => {
      const isValid = !value || validateEmail(value);
      if (isDirty && value && !isValid) {
        setEmailError(t("fields.email.errorInvalid", "Please enter a valid email address"));
      } else {
        setEmailError(null);
      }
      // Notify parent component about validation status
      onValidationChange?.(isValid);
    },
    500, // 500ms delay
  );

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value.toLowerCase();
    setEmailError(null); // Clear error when typing

    debouncedValidation(newEmail);

    // Update the state
    setData({ ...data, email: newEmail });
    // Store in localStorage
    window.localStorage.setItem("papermark.email", newEmail);

    // Optional: Clear error if input becomes valid
    if (e.target.validity.valid) {
      setEmailError(null);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsDirty(true);
    const value = e.target.value;
    const isValid = !value || validateEmail(value);
    if (value && !isValid) {
      setEmailError(t("fields.email.errorInvalid", "Please enter a valid email address"));
    }
    onValidationChange?.(isValid);
  };

  const handleFocus = () => {
    // Optionally clear error when user focuses the input to type again
    setEmailError(null);
  };

  return (
    <div className="relative space-y-2">
      <label
        htmlFor="email"
        className="block text-sm font-medium leading-6 text-white"
        style={{ color: theme.textColor }}
      >
        {t("fields.email.label", "Email address")}
      </label>
      <input
        name="email"
        id="email"
        type="email"
        autoCorrect="off"
        autoComplete="email"
        autoFocus
        required
        translate="no"
        className={cn(
          "notranslate flex w-full cursor-text rounded-md border-0 bg-black py-1.5 text-gray-500 shadow-sm ring-1 ring-inset ring-gray-600 placeholder:text-[var(--access-placeholder)] focus:ring-2 focus:ring-inset focus:ring-[var(--access-input-focus)] sm:text-sm sm:leading-6",
          emailError && isDirty && "ring-red-500",
        )}
        style={
          {
            backgroundColor: theme.controlBgColor,
            borderColor: theme.controlBorderColor,
            "--access-placeholder": theme.controlPlaceholderColor,
            "--access-input-focus": theme.controlBorderStrongColor,
            color: disableEditEmail ? theme.subtleTextColor : theme.textColor,
          } as CSSProperties
        }
        value={email || ""}
        placeholder={t("fields.email.placeholder", "Enter email")}
        onChange={handleEmailChange}
        onInvalid={handleInvalid}
        onBlur={handleBlur}
        onFocus={handleFocus}
        disabled={disableEditEmail}
        data-1p-ignore
        aria-invalid={emailError ? "true" : "false"}
        aria-describedby={emailError ? "email-error" : undefined}
      />
      {emailError && (
        <p
          id="email-error"
          className="mt-1 text-sm text-red-500"
          style={{ color: theme.textColor }}
        >
          {emailError}
        </p>
      )}
      <p className="text-sm" style={{ color: theme.subtleTextColor }}>
        {hideFooterOnAccessForm
          ? t(
              "fields.email.sharedWithProvider",
              "This data will be shared with the content provider.",
            )
          : t(
              "fields.email.sharedWithSender",
              "This data will be shared with the sender.",
            )}
      </p>
    </div>
  );
}
