import { useEffect, useMemo, useRef, useState } from "react";

import {
  ACCESS_PREVIEW_MESSAGE,
  ACCESS_PREVIEW_READY,
  type AccessPreviewPayload,
} from "./access-preview-message";
import { CustomFieldData } from "./custom-fields-panel";

export default function AccessScreenPreview({
  fields = [],
  requireEmail = true,
  requirePassword = false,
  requireAgreement = false,
  welcomeMessage,
  height = 450,
}: {
  fields?: CustomFieldData[];
  requireEmail?: boolean;
  requirePassword?: boolean;
  requireAgreement?: boolean;
  welcomeMessage?: string | null;
  height?: number;
}) {
  const payload = useMemo<AccessPreviewPayload>(
    () => ({
      requireEmail,
      requirePassword,
      requireAgreement,
      welcomeMessage: welcomeMessage || "",
      fields: fields.map((field, index) => ({
        type: field.type || "SHORT_TEXT",
        identifier: field.identifier || `field-${index}`,
        label: field.label?.trim() || "Field label",
        placeholder: field.placeholder,
        required: field.required,
      })),
    }),
    [fields, requireEmail, requirePassword, requireAgreement, welcomeMessage],
  );

  // The iframe is mounted once with the initial state baked into the URL (so
  // the first paint is already correct). Every later edit is streamed in over
  // postMessage instead of reloading the route — no reload means no flash.
  const [initialSrc] = useState(() => {
    const params = new URLSearchParams({
      requireEmail: String(payload.requireEmail),
      requirePassword: String(payload.requirePassword),
      requireAgreement: String(payload.requireAgreement),
      welcomeMessage: payload.welcomeMessage,
      fields: JSON.stringify(payload.fields),
    });
    return `/custom_fields_ppreview_demo?${params.toString()}`;
  });

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  // Always post the freshest payload without re-subscribing the listener.
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  useEffect(() => {
    const post = () => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: ACCESS_PREVIEW_MESSAGE, payload: payloadRef.current },
        window.location.origin,
      );
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== ACCESS_PREVIEW_READY) return;
      readyRef.current = true;
      post();
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Stream subsequent edits once the preview has announced it is listening.
  useEffect(() => {
    if (!readyRef.current) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: ACCESS_PREVIEW_MESSAGE, payload },
      window.location.origin,
    );
  }, [payload]);

  return (
    <div className="flex h-full flex-col">
      <p className="mb-3 text-sm font-medium text-foreground">Preview</p>
      <div className="flex justify-center">
        <div
          className="relative w-full max-w-[698px] rounded-lg bg-gray-200 p-1 shadow-lg"
          style={{ height }}
        >
          <div className="relative flex h-full flex-col overflow-hidden rounded-lg bg-gray-100">
            {/* Browser chrome */}
            <div className="mx-auto flex h-7 shrink-0 items-center justify-center">
              <div className="pointer-events-none absolute left-3">
                <div className="flex flex-row flex-nowrap justify-start">
                  <div className="pointer-events-auto">
                    <div className="mr-1 inline-block size-2 rounded-full bg-gray-300"></div>
                  </div>
                  <div className="pointer-events-auto">
                    <div className="mr-1 inline-block size-2 rounded-full bg-gray-300"></div>
                  </div>
                  <div className="pointer-events-auto">
                    <div className="mr-1 inline-block size-2 rounded-full bg-gray-300"></div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-center rounded-xl bg-white p-1 px-2 opacity-70">
                <div
                  aria-hidden="true"
                  className="mr-1 mt-0.5 flex text-muted-foreground"
                >
                  <svg
                    aria-hidden="true"
                    height="8"
                    width="8"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M8.75 11.25a1.25 1.25 0 1 0-1.5 0v1a.75.75 0 0 0 1.5 0v-1Z"></path>
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M3.5 4v2h-1a1 1 0 0 0-1 1v6a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3V7a1 1 0 0 0-1-1h-1V4a4 4 0 0 0-4-4h-1a4 4 0 0 0-4 4ZM11 6V4a2.5 2.5 0 0 0-2.5-2.5h-1A2.5 2.5 0 0 0 5 4v2h6Zm-8 7V7.5h10V13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13Z"
                    ></path>
                  </svg>
                </div>
                <span className="whitespace-normal text-xs text-muted-foreground">
                  papermark.com/view/...
                </span>
              </div>
            </div>

            {/* Scaled front-page iframe */}
            <div className="relative min-h-0 flex-1 overflow-x-auto">
              <div className="relative h-full max-w-[1396px]">
                <iframe
                  ref={iframeRef}
                  name="access-screen-preview"
                  id="access-screen-preview"
                  src={initialSrc}
                  sandbox="allow-scripts allow-same-origin"
                  className="absolute left-0 top-0 h-full w-full origin-top-left scale-50 overflow-hidden rounded-b-lg border-0 bg-white"
                  style={{
                    width: "200%",
                    height: "200%",
                    pointerEvents: "none",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
