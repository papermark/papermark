import Head from "next/head";

import { useEffect } from "react";

export const DEFAULT_VIEWER_BACKGROUND_COLOR = "rgb(3, 7, 18)";

export function ViewerThemeColor({
  color,
}: {
  color?: string | null;
}) {
  const themeColor = color || DEFAULT_VIEWER_BACKGROUND_COLOR;

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    const prevHtmlBg = html.style.backgroundColor;
    const prevBodyBg = body.style.backgroundColor;

    html.style.backgroundColor = themeColor;
    body.style.backgroundColor = themeColor;

    return () => {
      html.style.backgroundColor = prevHtmlBg;
      body.style.backgroundColor = prevBodyBg;
    };
  }, [themeColor]);

  return (
    <Head>
      <meta name="theme-color" content={themeColor} key="theme-color" />
    </Head>
  );
}
