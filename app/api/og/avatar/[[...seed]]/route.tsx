import { getAvatarTheme } from "@/lib/utils";
import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ seed?: string[] }> },
) {
  const params = await props.params;
  const { searchParams } = new URL(req.url);
  const seed = params.seed?.[0] ?? searchParams.get("seed");
  const theme = getAvatarTheme(seed);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.bg,
        }}
      >
        {/* Head */}
        <div
          style={{
            position: "absolute",
            top: "22",
            width: "44",
            height: "44",
            borderRadius: "22",
            backgroundColor: theme.fg,
            opacity: 0.85,
          }}
        />
        {/* Body — wider pill shape */}
        <div
          style={{
            position: "absolute",
            bottom: "-10",
            width: "80",
            height: "52",
            borderRadius: "40px 40px 0 0",
            backgroundColor: theme.fg,
            opacity: 0.85,
          }}
        />
      </div>
    ),
    {
      width: 128,
      height: 128,
      headers: {
        "Vercel-CDN-Cache-Control": "s-maxage=31536000",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  );
}
