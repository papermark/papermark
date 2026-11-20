import { useRouter } from "next/router";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { CustomField } from "@prisma/client";
import { EyeOff } from "lucide-react";

import {
  ACCESS_PREVIEW_MESSAGE,
  ACCESS_PREVIEW_READY,
  type AccessPreviewPayload,
} from "@/components/links/link-sheet/access-preview-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AccessFormThemeProvider,
  createAccessFormTheme,
} from "@/components/view/access-form/access-form-theme";
import CustomFieldsViewer from "@/components/view/access-form/custom-fields-section";

type PreviewState = {
  accentColor?: string;
  welcomeMessage: string;
  requireEmail: boolean;
  requirePassword: boolean;
  requireAgreement: boolean;
  fields: Partial<CustomField>[];
};

const DEFAULT_STATE: PreviewState = {
  welcomeMessage: "",
  requireEmail: true,
  requirePassword: false,
  requireAgreement: false,
  fields: [],
};

export default function CustomFieldsPreviewDemo() {
  const router = useRouter();
  const [state, setState] = useState<PreviewState>(DEFAULT_STATE);
  // Bootstrap from the URL at most once, and never after a live message has
  // already arrived — otherwise a late `router.isReady` flip would clobber the
  // freshest streamed state with the stale initial URL values.
  const bootstrappedRef = useRef(false);
  const messageReceivedRef = useRef(false);

  // First paint: hydrate from the URL the parent baked the initial state into.
  useEffect(() => {
    if (!router.isReady || bootstrappedRef.current || messageReceivedRef.current)
      return;
    bootstrappedRef.current = true;
    const {
      accentColor,
      welcomeMessage,
      requireEmail,
      requirePassword,
      requireAgreement,
      fields,
    } = router.query as Record<string, string | undefined>;

    let parsedFields: Partial<CustomField>[] = [];
    try {
      parsedFields = fields ? JSON.parse(fields) : [];
    } catch {
      parsedFields = [];
    }

    setState({
      accentColor,
      welcomeMessage: welcomeMessage ?? "",
      requireEmail: requireEmail !== "false",
      requirePassword: requirePassword === "true",
      requireAgreement: requireAgreement === "true",
      fields: parsedFields,
    });
  }, [router.isReady, router.query]);

  // Live updates: the editor streams changes over postMessage so the preview
  // never has to reload (and therefore never flashes).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== ACCESS_PREVIEW_MESSAGE) return;
      messageReceivedRef.current = true;
      const payload = event.data.payload as AccessPreviewPayload;
      setState((prev) => ({
        ...prev,
        welcomeMessage: payload.welcomeMessage ?? "",
        requireEmail: !!payload.requireEmail,
        requirePassword: !!payload.requirePassword,
        requireAgreement: !!payload.requireAgreement,
        fields: Array.isArray(payload.fields)
          ? (payload.fields as Partial<CustomField>[])
          : [],
      }));
    };

    window.addEventListener("message", onMessage);
    // Tell the parent the listener is attached and it can start streaming.
    window.parent?.postMessage(
      { type: ACCESS_PREVIEW_READY },
      window.location.origin,
    );
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const theme = createAccessFormTheme(state.accentColor);

  const parsedFields = state.fields;
  const { welcomeMessage, accentColor } = state;
  const showEmail = state.requireEmail;
  const showPassword = state.requirePassword;
  const showAgreement = state.requireAgreement;

  return (
    <div
      className="bg-gray-950"
      style={{ backgroundColor: accentColor || theme.backgroundColor }}
    >
      <div className="mx-auto px-2 sm:px-6 lg:px-8">
        <div className="relative flex h-16 items-center justify-between">
          <div className="mt-20 flex flex-1 items-stretch justify-center"></div>
        </div>
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h1
            className="mt-16 text-2xl font-bold leading-9 tracking-tight text-white"
            style={{ color: theme.textColor }}
          >
            {welcomeMessage || "Your action is requested to continue"}
          </h1>
        </div>

        <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-md">
          <AccessFormThemeProvider value={theme}>
            <form className="space-y-4">
              {showEmail && (
                <div className="pb-1">
                  <div className="relative space-y-2 rounded-md shadow-sm">
                    <label
                      htmlFor="email"
                      className="block text-sm font-medium leading-6 text-white"
                      style={{ color: theme.textColor }}
                    >
                      Email address
                    </label>
                    <input
                      name="email"
                      id="email"
                      type="email"
                      readOnly
                      className="flex w-full cursor-text rounded-md border-0 bg-black py-1.5 text-white shadow-sm ring-1 ring-inset ring-gray-600 placeholder:text-[var(--access-placeholder)] sm:text-sm sm:leading-6"
                      style={
                        {
                          backgroundColor: theme.controlBgColor,
                          borderColor: theme.controlBorderColor,
                          "--access-placeholder": theme.controlPlaceholderColor,
                          "--access-input-focus":
                            theme.controlBorderStrongColor,
                          color: theme.textColor,
                        } as CSSProperties
                      }
                      placeholder="Enter email"
                      data-1p-ignore
                    />
                    <p
                      className="text-sm"
                      style={{ color: theme.subtleTextColor }}
                    >
                      This data will be shared with the sender.
                    </p>
                  </div>
                </div>
              )}

              {showPassword && (
                <div className="space-y-2 rounded-md shadow-sm">
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium leading-6 text-white"
                    style={{ color: theme.textColor }}
                  >
                    Passcode
                  </label>
                  <div className="relative">
                    <input
                      name="password"
                      id="password"
                      type="password"
                      readOnly
                      className="flex w-full cursor-text rounded-md border-0 bg-black py-1.5 text-white shadow-sm ring-1 ring-inset ring-gray-600 placeholder:text-[var(--access-placeholder)] sm:text-sm sm:leading-6"
                      style={
                        {
                          backgroundColor: theme.controlBgColor,
                          borderColor: theme.controlBorderColor,
                          "--access-placeholder": theme.controlPlaceholderColor,
                          color: theme.textColor,
                        } as CSSProperties
                      }
                      placeholder="Enter passcode"
                      data-1p-ignore
                    />
                    <span className="absolute inset-y-0 right-0 flex items-center pr-3">
                      <EyeOff
                        className="h-4 w-4"
                        style={{ color: theme.controlIconColor }}
                        aria-hidden="true"
                      />
                    </span>
                  </div>
                </div>
              )}

              <CustomFieldsViewer
                fields={parsedFields}
                data={{}}
                setData={() => {}}
              />

              {showAgreement && (
                <div className="relative flex items-start space-x-2 pt-5">
                  <Checkbox
                    id="agreement"
                    checked={false}
                    className="border border-gray-400"
                    style={
                      {
                        borderColor: theme.controlBorderStrongColor,
                      } as CSSProperties
                    }
                  />
                  <label
                    className="text-sm font-normal leading-5 text-white"
                    style={{ color: theme.textColor }}
                  >
                    I have reviewed and agree to the terms of this agreement.
                  </label>
                </div>
              )}

              <div className="flex justify-center pt-5">
                <Button
                  type="button"
                  className="w-1/3 min-w-fit bg-white text-gray-950 hover:bg-white/90"
                  style={{
                    backgroundColor: theme.ctaBgColor,
                    color: theme.ctaTextColor,
                  }}
                >
                  Continue
                </Button>
              </div>
            </form>
          </AccessFormThemeProvider>
        </div>
      </div>

      <div
        style={{ height: "calc(100vh - 64px)" }}
        className="relative flex items-center"
      >
        <div className="relative mx-auto flex h-full w-full justify-center"></div>
      </div>
    </div>
  );
}
