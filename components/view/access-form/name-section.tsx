import { Dispatch, SetStateAction, useEffect } from "react";
import type { CSSProperties } from "react";

import { Brand, DataroomBrand } from "@prisma/client";
import { useTranslation } from "react-i18next";

import { DEFAULT_ACCESS_FORM_TYPE } from ".";
import { useAccessFormTheme } from "./access-form-theme";

export default function NameSection({
  data,
  setData,
  brand,
  disableEditName,
}: {
  data: DEFAULT_ACCESS_FORM_TYPE;
  setData: Dispatch<SetStateAction<DEFAULT_ACCESS_FORM_TYPE>>;
  brand?: Partial<Brand> | Partial<DataroomBrand> | null;
  disableEditName?: boolean;
}) {
  const { name } = data;
  const theme = useAccessFormTheme();
  const { t } = useTranslation("access-form");

  useEffect(() => {
    if (disableEditName) {
      return;
    }
    const storedName = window.localStorage.getItem("papermark.name");
    if (storedName) {
      setData((prevData) => ({
        ...prevData,
        name: storedName,
      }));
    }
  }, [setData, disableEditName]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    window.localStorage.setItem("papermark.name", newName);
    setData({ ...data, name: newName });
  };

  return (
    <div className="relative space-y-2 rounded-md shadow-sm">
      <label
        htmlFor="name"
        className="block text-sm font-medium leading-6 text-white"
        style={{ color: theme.textColor }}
      >
        {t("fields.name.label", "Name")}
      </label>
      <input
        name="name"
        id="name"
        type="text"
        autoCorrect="off"
        autoComplete="off"
        autoFocus
        translate="no"
        className="notranslate flex w-full cursor-text rounded-md border-0 bg-black py-1.5 text-white shadow-sm ring-1 ring-inset ring-gray-600 placeholder:text-[var(--access-placeholder)] focus:ring-2 focus:ring-inset focus:ring-[var(--access-input-focus)] disabled:cursor-not-allowed disabled:opacity-90 sm:text-sm sm:leading-6"
        style={{
          backgroundColor: theme.controlBgColor,
          borderColor: theme.controlBorderColor,
          "--access-placeholder": theme.controlPlaceholderColor,
          "--access-input-focus": theme.controlBorderStrongColor,
          color: disableEditName ? theme.subtleTextColor : theme.textColor,
        } as CSSProperties}
        value={name || ""}
        placeholder={t("fields.name.placeholder", "Enter your full name")}
        onChange={handleNameChange}
        disabled={disableEditName}
        aria-invalid="true"
        data-1p-ignore
      />
    </div>
  );
}
