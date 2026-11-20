import { NextFetchEvent, NextRequest, NextResponse } from "next/server";

import AppMiddleware from "@/lib/middleware/app";
import DomainMiddleware from "@/lib/middleware/domain";

import { BLOCKED_PATHNAMES } from "./lib/constants";
import IncomingWebhookMiddleware, {
  isWebhookPath,
} from "./lib/middleware/incoming-webhooks";
import PostHogMiddleware from "./lib/middleware/posthog";

function isAnalyticsPath(path: string) {
  // Create a regular expression
  // ^ - asserts position at start of the line
  // /ingest/ - matches the literal string "/ingest/"
  // .* - matches any character (except for line terminators) 0 or more times
  const pattern = /^\/ingest\/.*/;

  return pattern.test(path);
}

function isCustomDomain(host: string) {
  return (
    (process.env.NODE_ENV === "development" &&
      (host?.includes(".local") || host?.includes("papermark.dev"))) ||
    (process.env.NODE_ENV !== "development" &&
      !(
        host?.includes("localhost") ||
        host?.includes("papermark.io") ||
        host?.includes("papermark.com") ||
        host?.endsWith(".vercel.app")
      ))
  );
}

export const config = {
  matcher: [
    /*
     * Match all paths except for:
     * 1. /api/ routes
     * 2. /_next/ (Next.js internals)
     * 3. /_static (inside /public)
     * 4. /_vercel (Vercel internals)
     * 5. /favicon.ico, /sitemap.xml, /robots.txt (static files)
     * 6. /mcp and /mcp/ (remote MCP endpoint — does its own Bearer-token
     *    auth and returns 401; must not be bounced to /login. End-anchored
     *    so it matches only that exact path, not /mcp-oauth/*.)
     */
    "/((?!api/|oauth/|mcp/?$|\\.well-known/|_next/|_static|vendor|_icons|_vercel|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};

export default async function middleware(req: NextRequest, ev: NextFetchEvent) {
  const path = req.nextUrl.pathname;
  const host = req.headers.get("host");

  // api.papermark.com is restricted to the v1 surface. Filesystem pages
  // (/dashboard, /settings, /login, …) would otherwise render here too,
  // because Next.js routes pages on every host bound to the project.
  // The Host header carries the port for non-default ports (e.g.
  // `localhost:3000` in dev), so strip it before comparing to the env var
  // — which is set to a bare hostname.
  const apiHost = process.env.NEXT_PUBLIC_API_BASE_HOST?.toLowerCase().trim();
  const requestHostname = host?.split(":")[0]?.toLowerCase().trim();
  if (apiHost && requestHostname === apiHost) {
    if (path === "/v1" || path.startsWith("/v1/") || path === "/openapi.json") {
      return NextResponse.next();
    }
    if (path === "/") {
      return NextResponse.redirect("https://www.papermark.com/docs/api", 302);
    }
    return new NextResponse(null, { status: 404 });
  }

  if (isAnalyticsPath(path)) {
    return PostHogMiddleware(req);
  }

  // Handle incoming webhooks
  if (isWebhookPath(host)) {
    return IncomingWebhookMiddleware(req);
  }

  // For custom domains, we need to handle them differently
  if (isCustomDomain(host || "")) {
    return DomainMiddleware(req);
  }

  // Handle standard papermark.com paths
  if (
    !path.startsWith("/view/") &&
    !path.startsWith("/verify") &&
    !path.startsWith("/unsubscribe") &&
    !path.startsWith("/notification-preferences") &&
    !path.startsWith("/auth/email")
  ) {
    return AppMiddleware(req);
  }

  // Check for blocked pathnames in view routes
  if (
    path.startsWith("/view/") &&
    (BLOCKED_PATHNAMES.some((blockedPath) => path.includes(blockedPath)) ||
      path.includes("."))
  ) {
    const url = req.nextUrl.clone();
    url.pathname = "/404";
    return NextResponse.rewrite(url, { status: 404 });
  }

  return NextResponse.next();
}
