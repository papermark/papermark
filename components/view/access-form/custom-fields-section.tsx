import { Brand, CustomField, DataroomBrand } from "@prisma/client";
import { E164Number } from "libphonenumber-js";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Textarea } from "@/components/ui/textarea";
import { useAccessFormTheme } from "./access-form-theme";

export default function CustomFieldsSection({
  fields,
  data,
  setData,
  brand,
}: {
  fields: Partial<CustomField>[];
  data: { [key: string]: string };
  setData: (data: { [key: string]: string }) => void;
  brand?: Partial<Brand> | Partial<DataroomBrand> | null;
}) {
  const theme = useAccessFormTheme();
  const { t } = useTranslation("access-form");

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    identifier: string,
  ) => {
    setData({ ...data, [identifier]: e.target.value });
  };

  const handlePhoneChange = (value: E164Number | null, identifier: string) => {
    setData({ ...data, [identifier]: value || "" });
  };

  const handleCheckboxChange = (checked: boolean, identifier: string) => {
    setData({ ...data, [identifier]: String(checked) });
  };

  if (!fields?.length) return null;

  return (
    <div className="space-y-5">
      {fields.map((field, index) => {
        if (!field.identifier) return null;

        const value = data[field.identifier] || "";
        const isLongText = field.type === "LONG_TEXT";
        const isPhoneNumber = field.type === "PHONE_NUMBER";
        const isCheckbox = field.type === "CHECKBOX";

        return (
          <div key={field.identifier} className="relative space-y-2">
            {!isCheckbox && (
              <label
                htmlFor={field.identifier}
                className="block text-sm font-medium leading-6 text-white"
                style={{ color: theme.textColor }}
              >
                {field.label}
              </label>
            )}
            {isCheckbox ? (
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={field.identifier}
                  checked={value === "true"}
                  onCheckedChange={(checked) =>
                    handleCheckboxChange(!!checked, field.identifier!)
                  }
                  disabled={field.disabled}
                  className={cn(
                    "border-gray-600 data-[state=checked]:bg-gray-300 data-[state=checked]:text-black",
                  )}
                  style={{
                    borderColor: theme.controlBorderColor,
                  }}
                />
                <label
                  htmlFor={field.identifier}
                  className="cursor-pointer text-sm font-medium leading-none text-white peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  style={{ color: theme.textColor }}
                >
                  {field.label}
                  {field.required && (
                    <span className="ml-1 text-red-500">*</span>
                  )}
                </label>
              </div>
            ) : isPhoneNumber ? (
              <PhoneInput
                id={field.identifier}
                value={value as E164Number}
                onChange={(phoneValue) =>
                  handlePhoneChange(phoneValue, field.identifier!)
                }
                placeholder={
                  field.placeholder || t("fields.phone.placeholderDefault", "+1 123 456 7890")
                }
                defaultCountry="US"
                disabled={field.disabled}
                translate="no"
                className={cn(
                  "notranslate flex w-full cursor-text rounded-md border-0 bg-black text-gray-500 placeholder:text-[var(--access-placeholder)] sm:text-sm sm:leading-6",
                )}
                style={
                  {
                    "--phone-input-bg": theme.controlBgColor,
                    "--phone-input-color": theme.textColor,
                    "--access-placeholder": theme.controlPlaceholderColor,
                  } as React.CSSProperties
                }
              />
            ) : (
              (() => {
                const InputComponent = isLongText ? Textarea : Input;
                return (
                  <InputComponent
                    name={field.identifier || ""}
                    id={field.id || ""}
                    type={
                      field.type === "NUMBER"
                        ? "number"
                        : field.type === "URL"
                          ? "url"
                          : "text"
                    }
                    pattern={field.type === "URL" ? "https://.*" : undefined}
                    onInvalid={(e) => {
                      if (field.type === "URL") {
                        e.currentTarget.setCustomValidity(
                          t("fields.url.errorInvalid", "Please enter a valid URL starting with https://"),
                        );
                      }
                    }}
                    onInput={(e) => e.currentTarget.setCustomValidity("")}
                    autoComplete="off"
                    data-1p-ignore
                    required={field.required}
                    disabled={field.disabled}
                    translate="no"
                    className={cn(
                      "notranslate flex w-full cursor-text rounded-md border-0 bg-black py-1.5 text-gray-500 shadow-sm ring-1 ring-inset ring-gray-600 placeholder:text-[var(--access-placeholder)] focus:ring-2 focus:ring-inset focus:ring-[var(--access-input-focus)] sm:text-sm sm:leading-6",
                      isLongText && "min-h-[100px] resize-none",
                    )}
                    style={
                      {
                        backgroundColor: theme.controlBgColor,
                        borderColor: theme.controlBorderColor,
                        "--access-placeholder":
                          theme.controlPlaceholderColor,
                        "--access-input-focus": theme.controlBorderStrongColor,
                        color: theme.textColor,
                      } as React.CSSProperties
                    }
                    value={value}
                    placeholder={field.placeholder || ""}
                    onChange={(e) => handleInputChange(e, field.identifier!)}
                  />
                );
              })()
            )}
          </div>
        );
      })}
    </div>
  );
}
