import { useEffect, useState } from "react";

import { motion } from "motion/react";

import { FADE_IN_ANIMATION_SETTINGS } from "@/lib/constants";
import { stripTrailingPasswordWhitespace } from "@/lib/utils";

import Eye from "@/components/shared/icons/eye";
import EyeOff from "@/components/shared/icons/eye-off";
import { Input } from "@/components/ui/input";

import { DEFAULT_LINK_TYPE } from ".";
import LinkItem from "./link-item";

export default function PasswordSection({
  data,
  setData,
}: {
  data: DEFAULT_LINK_TYPE;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_LINK_TYPE>>;
}) {
  const { password } = data;
  const [enabled, setEnabled] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  useEffect(() => {
    setEnabled(!!password);
  }, [password]);

  const handleEnablePassword = () => {
    if (enabled) {
      // if password protection is currently enabled and we're toggling it off
      setData({ ...data, password: null });
    }
    setEnabled(!enabled);
  };

  return (
    <div className="pb-5">
      <LinkItem
        title="Password protection"
        enabled={enabled}
        action={handleEnablePassword}
        tooltipContent="Users must enter a password to access the content."
        link="https://www.papermark.com/password-protection"
      />

      {enabled && (
        <motion.div
          className="relative mt-4 rounded-md shadow-sm"
          {...FADE_IN_ANIMATION_SETTINGS}
        >
          <Input
            name="password"
            id="password"
            autoComplete="off"
            data-1p-ignore
            type={showPassword ? "text" : "password"}
            className="focus:ring-inset"
            // className="flex w-full rounded-md border-0 bg-background py-1.5 text-foreground shadow-sm ring-1 ring-inset ring-input placeholder:text-muted-foreground focus:ring-2 focus:ring-inset focus:ring-gray-400 sm:text-sm sm:leading-6"
            value={password || ""}
            placeholder="Enter password"
            onChange={(e) => {
              setData({ ...data, password: e.target.value });
            }}
            onBlur={() => {
              setData((prev) => ({
                ...prev,
                password: prev.password
                  ? stripTrailingPasswordWhitespace(prev.password)
                  : prev.password,
              }));
            }}
            aria-invalid="true"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 flex items-center pr-3"
          >
            {showPassword ? (
              <Eye
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <EyeOff
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </button>
        </motion.div>
      )}
    </div>
  );
}
