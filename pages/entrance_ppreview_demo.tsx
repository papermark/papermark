import type { CSSProperties } from "react";

import { useBrandingPreviewParams } from "@/ee/features/branding/lib/use-branding-preview-params";
import { createAdaptiveSurfacePalette } from "@/lib/utils/create-adaptive-surface-palette";

import { Button } from "@/components/ui/button";

export default function ViewPage() {
  // Seeded from the URL on first paint, then live-updated over postMessage so
  // the editor never has to reload (and therefore never flashes) this iframe.
  const { accentColor, welcomeMessage } = useBrandingPreviewParams();
  const palette = createAdaptiveSurfacePalette(accentColor);

  return (
    <div className="bg-gray-950" style={{ backgroundColor: accentColor }}>
      <div className="mx-auto px-2 sm:px-6 lg:px-8">
        <div className="relative flex h-16 items-center justify-between">
          <div className="mt-20 flex flex-1 items-stretch justify-center"></div>
        </div>
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h1
            className="mt-16 text-2xl font-bold leading-9 tracking-tight text-white"
            style={{
              color: palette.textColor,
            }}
          >
            {welcomeMessage || "Your action is requested to continue"}
          </h1>
        </div>

        <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-md">
          <form className="space-y-4">
            <div className="pb-5">
              <div className="relative space-y-2 rounded-md shadow-sm">
                <label
                  htmlFor="email"
                  className="block text-sm font-medium leading-6 text-white"
                  style={{
                    color: palette.textColor,
                  }}
                >
                  Email address
                </label>
                <input
                  name="email"
                  id="email"
                  type="email"
                  autoCorrect="off"
                  autoComplete="email"
                  autoFocus
                  className="flex w-full cursor-text rounded-md border-0 bg-black py-1.5 text-white shadow-sm ring-1 ring-inset ring-gray-600 placeholder:text-[var(--access-placeholder)] focus:ring-2 focus:ring-inset focus:ring-[var(--access-input-focus)] sm:text-sm sm:leading-6"
                  style={{
                    backgroundColor: palette.controlBgColor,
                    borderColor: palette.controlBorderColor,
                    "--access-placeholder": palette.controlPlaceholderColor,
                    "--access-input-focus": palette.controlBorderStrongColor,
                    color: palette.textColor,
                  } as CSSProperties}
                  placeholder="Enter email"
                  aria-invalid="true"
                  data-1p-ignore
                />
                <p className="text-sm" style={{ color: palette.subtleTextColor }}>
                  This data will be shared with the sender.
                </p>
              </div>
            </div>

            <div className="flex justify-center">
              <Button
                type="submit"
                className="w-1/3 min-w-fit bg-white text-gray-950 hover:bg-white/90"
              >
                Continue
              </Button>
            </div>
          </form>
        </div>
      </div>
      {/* </nav> */}

      {/* Body */}
      <div
        style={{ height: "calc(100vh - 64px)" }}
        className="relative flex items-center"
      >
        <div className="relative mx-auto flex h-full w-full justify-center"></div>
      </div>
    </div>
  );
}
