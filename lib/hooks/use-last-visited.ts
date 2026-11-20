import { useRouter } from "next/router";

import { useEffect, useRef, useState } from "react";

// Versioned key so the schema can evolve without colliding with old values.
const STORAGE_KEY = "papermark:last-visited:v1";
// Per-tab session flag: marks that we've already handled "platform entry",
// so a later manual visit to /dashboard does not bounce the user away.
const ENTRY_FLAG_KEY = "papermark:entry-handled";
// Ignore stale destinations so users are not teleported to something they
// opened weeks ago.
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

type LastVisited = { path: string; ts: number };

// Paths that should never be remembered as a "last visited" destination, nor
// act as the page we redirect away from on entry. The default landing page
// (/dashboard), the onboarding flow (/welcome), and shared viewer links
// (/view) are intentionally excluded.
const TRACK_DENYLIST = [
  "/dashboard",
  "/welcome",
  "/login",
  "/register",
  "/auth",
  "/view",
];

// Route segments that opt a whole subtree out of tracking. The dataroom Q&A
// pages (/datarooms/[id]/conversations...) rewrite the URL with
// history.replaceState behind the router's back, so router.asPath goes stale
// there and the saved value would not match what the user actually sees.
const TRACK_DENY_SEGMENTS = ["conversations"];

// Branding preview iframes (e.g. /room_ppreview_demo, /nav_ppreview_demo,
// /entrance_ppreview_demo, /custom_fields_ppreview_demo) are rendered inside
// the branding editors' same-origin <iframe>s. Since _app mounts the tracker on
// every non-excluded page, the iframe would otherwise record itself as the
// "last visited" destination and bounce the user into a standalone preview page
// on their next entry. Any route whose segment ends with this suffix is such a
// preview and must never be tracked.
const PREVIEW_DEMO_SUFFIX = "_ppreview_demo";

// Pages that don't count as "being inside the app" yet for entry handling:
// rendering any page outside this list marks the tab session as entered.
const ENTRY_NEUTRAL_PATHS = [
  "/dashboard",
  "/welcome",
  "/login",
  "/register",
  "/auth",
  "/view",
];

function getPathname(path: string): string {
  return path.split(/[?#]/)[0];
}

function matchesPathPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isTrackablePath(path: string): boolean {
  const pathname = getPathname(path);
  // Next.js exposes the unresolved route template (e.g. /datarooms/[id]) as
  // asPath while a statically-optimized page hydrates; never treat those as
  // real destinations.
  if (pathname.includes("[")) return false;
  if (matchesPathPrefix(pathname, TRACK_DENYLIST)) return false;
  const segments = pathname.split("/");
  if (segments.some((segment) => segment.endsWith(PREVIEW_DEMO_SUFFIX))) {
    return false;
  }
  return !TRACK_DENY_SEGMENTS.some((denied) => segments.includes(denied));
}

export function saveLastVisited(path: string) {
  if (typeof window === "undefined") return;
  try {
    const value: LastVisited = { path, ts: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // localStorage throws in private mode / when full — safe to ignore.
  }
}

export function getLastVisited(): LastVisited | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastVisited;
    if (!parsed?.path || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > MAX_AGE_MS) return null;
    // Older versions stored route templates and now-denylisted paths (e.g.
    // /datarooms/<id>/conversations/); drop those instead of redirecting.
    if (!parsed.path.startsWith("/") || !isTrackablePath(parsed.path)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearLastVisited() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function isEntryHandled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.sessionStorage.getItem(ENTRY_FLAG_KEY) === "1";
  } catch {
    return true;
  }
}

function markEntryHandled() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ENTRY_FLAG_KEY, "1");
  } catch {
    // ignore
  }
}

/**
 * Records the user's current location so we can route them back here next time
 * they enter the platform. Mount once globally for authenticated app pages.
 */
export function useTrackLastVisited() {
  const router = useRouter();

  useEffect(() => {
    // Before isReady, asPath on statically-optimized dynamic routes is still
    // the unresolved template (e.g. /datarooms/[id]/documents) — wait for the
    // real URL.
    if (!router.isReady) return;

    const pathname = getPathname(router.asPath);
    if (!matchesPathPrefix(pathname, ENTRY_NEUTRAL_PATHS)) {
      // The user is already inside the app on a real page, so this tab
      // session's "platform entry" is settled — entering the app on a deep
      // link (e.g. a Q&A page) must not make a later manual /dashboard visit
      // bounce them back.
      markEntryHandled();
    }

    if (isTrackablePath(router.asPath)) {
      saveLastVisited(router.asPath);
    }
  }, [router.isReady, router.asPath]);
}

/**
 * On the first load of /dashboard in a tab session (i.e. platform entry),
 * redirect to the last meaningful location the user visited, if any. Manual
 * navigations to /dashboard within the same session are left untouched.
 *
 * Returns whether a redirect is in flight so the caller can render a loader
 * instead of flashing the dashboard.
 */
export function useEntryRedirect(): boolean {
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (isEntryHandled()) return;
    markEntryHandled();

    const last = getLastVisited();
    const target = last?.path;
    if (!target || getPathname(target) === "/dashboard") return;

    setRedirecting(true);
    void router.replace(target).catch(() => {
      // The stored destination may have been deleted or access revoked; drop
      // it and stay on the dashboard rather than looping on a dead route.
      clearLastVisited();
      setRedirecting(false);
    });
  }, [router]);

  return redirecting;
}
