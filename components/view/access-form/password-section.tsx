import { Dispatch, SetStateAction, useState } from "react";
import type { CSSProperties } from "react";

import { Brand, DataroomBrand } from "@prisma/client";
import { useTranslation } from "react-i18next";

import Eye from "@/components/shared/icons/eye";
import EyeOff from "@/components/shared/icons/eye-off";

import { DEFAULT_ACCESS_FORM_TYPE } from ".";
import { useAccessFormTheme } from "./access-form-theme";

export default function PasswordSection({
  data,
  setData,
  brand,
  disableEditPassword,
}: {
  data: DEFAULT_ACCESS_FORM_TYPE;
  setData: Dispatch<SetStateAction<DEFAULT_ACCESS_FORM_TYPE>>;
  brand?: Partial<Brand> | Partial<DataroomBrand> | null;
  disableEditPassword?: boolean;
}) {
  const { password } = data;
  const theme = useAccessFormTheme();
  const { t } = useTranslation("access-form");
  const [showPassword, setShowPassword] = useState<boolean>(false);

  return (
    <div className="space-y-2 rounded-md shadow-sm">
      <label
        htmlFor="password"
        className="block text-sm font-medium leading-6 text-white"
        style={{ color: theme.textColor }}
      >
        {t("fields.password.label", "Passcode")}
      </label>
      <div className="relative">
        <input
          name="password"
          id="password"
          type={showPassword ? "text" : "password"}
          autoCorrect="off"
          autoComplete="off"
          translate="no"
          className="notranslate flex w-full cursor-text rounded-md border-0 bg-black py-1.5 text-white shadow-sm ring-1 ring-inset ring-gray-600 placeholder:text-[var(--access-placeholder)] focus:ring-2 focus:ring-inset focus:ring-[var(--access-input-focus)] sm:text-sm sm:leading-6"
          style={
            {
              backgroundColor: theme.controlBgColor,
              borderColor: theme.controlBorderColor,
              "--access-placeholder": theme.controlPlaceholderColor,
              "--access-input-focus": theme.controlBorderStrongColor,
              color: disableEditPassword
                ? theme.subtleTextColor
                : theme.textColor,
            } as CSSProperties
          }
          value={password || ""}
          placeholder={t("fields.password.placeholder", "Enter passcode")}
          onChange={(e) => {
            setData({ ...data, password: e.target.value });
          }}
          disabled={disableEditPassword}
          aria-invalid="true"
          data-1p-ignore
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute inset-y-0 right-0 flex items-center pr-3"
        >
          {showPassword ? (
            <Eye
              className="h-4 w-4"
              style={{ color: theme.controlIconColor }}
              aria-hidden="true"
            />
          ) : (
            <EyeOff
              className="h-4 w-4"
              style={{ color: theme.controlIconColor }}
              aria-hidden="true"
            />
          )}
        </button>
      </div>
    </div>
  );
}
