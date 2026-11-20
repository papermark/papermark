import { NextRequest, NextResponse } from "next/server";

import { getToken } from "next-auth/jwt";

const LOGIN_PATH = "/login";
const DEFAULT_AUTH_REDIRECT_PATH = "/dashboard";

function isProtocolRelativePath(path: string) {
  return path[1] === "/" || path[1] === "\\";
}

function normalizeNextPath(nextPath: string | null, requestUrl: string): string {
  if (!nextPath) {
    return DEFAULT_AUTH_REDIRECT_PATH;
  }

  let normalized = nextPath;

  // Handle already-encoded and double-encoded `next` values.
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) {
        break;
      }
      normalized = decoded;
    } catch {
      break;
    }
  }

  if (!normalized.startsWith("/") || isProtocolRelativePath(normalized)) {
    return DEFAULT_AUTH_REDIRECT_PATH;
  }

  try {
    const targetUrl = new URL(normalized, requestUrl);
    const requestOrigin = new URL(requestUrl).origin;

    if (targetUrl.origin !== requestOrigin) {
      return DEFAULT_AUTH_REDIRECT_PATH;
    }

    return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  } catch {
    return DEFAULT_AUTH_REDIRECT_PATH;
  }
}

export default async function AppMiddleware(req: NextRequest) {
  const url = req.nextUrl;
  const path = url.pathname;
  const isInvited = url.searchParams.has("invitation");
  const token = (await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  })) as {
    email?: string;
    user?: {
      createdAt?: string;
    };
  };

  // UNAUTHENTICATED if there's no token and the path isn't /login, redirect to /login
  if (!token?.email && path !== LOGIN_PATH) {
    const loginUrl = new URL(LOGIN_PATH, req.url);
    // Append "next" parameter only if not navigating to the root
    if (path !== "/") {
      // Some destinations carry meaningful query params (e.g. the allow-list
      // action link identifies the link and visitor email). Preserve the full
      // search string for those so it survives the login round-trip.
      const preserveSearch =
        path === "/auth/confirm-email-change" ||
        path === "/welcome" ||
        path.startsWith("/access/");
      const nextPath = preserveSearch ? `${path}${url.search}` : path;

      loginUrl.searchParams.set("next", nextPath);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (!token?.email && path === LOGIN_PATH) {
    const rawNextPath = url.searchParams.get("next");

    if (rawNextPath) {
      const normalizedNextPath = normalizeNextPath(rawNextPath, req.url);
      const canonicalLoginUrl = new URL(LOGIN_PATH, req.url);
      canonicalLoginUrl.searchParams.set("next", normalizedNextPath);

      if (canonicalLoginUrl.search !== url.search) {
        return NextResponse.redirect(canonicalLoginUrl, { status: 308 });
      }

      // Keep the base /login URL indexable for now, but deindex parameterized variants.
      const response = NextResponse.next();
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
      return response;
    }

    return NextResponse.next();
  }

  // AUTHENTICATED if the user was created in the last 10 seconds, redirect to "/welcome"
  if (
    token?.email &&
    token?.user?.createdAt &&
    new Date(token?.user?.createdAt).getTime() > Date.now() - 10000 &&
    path !== "/welcome" &&
    !isInvited
  ) {
    return NextResponse.redirect(new URL("/welcome", req.url));
  }

  // AUTHENTICATED if the path is /login, redirect to the next path
  if (token?.email && path === LOGIN_PATH) {
    const nextPath = normalizeNextPath(url.searchParams.get("next"), req.url);
    return NextResponse.redirect(new URL(nextPath, req.url));
  }

  return NextResponse.next();
}
