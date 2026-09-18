// Shared by the NextAuth route handler (writes the cookie) and the edge
// middleware (reads it via getToken). Both must derive the name the same way:
// a self-hosted HTTPS instance without VERCEL_URL used to write
// `next-auth.session-token` while getToken looked for
// `__Secure-next-auth.session-token`, so every page bounced to /login.
const VERCEL_DEPLOYMENT = !!process.env.VERCEL_URL;

function isHttpsUrl(url: string | undefined) {
  if (!url) return false;
  try {
    // URL normalises the scheme, so `HTTPS://` counts too.
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export const useSecureCookies =
  VERCEL_DEPLOYMENT || isHttpsUrl(process.env.NEXTAUTH_URL);

export const sessionCookieName = `${useSecureCookies ? "__Secure-" : ""}next-auth.session-token`;

export const sessionCookieDomain = VERCEL_DEPLOYMENT
  ? ".papermark.com"
  : undefined;
