import { useRouter } from "next/router";

import { useEffect, useState } from "react";

// A link's passcode is a secret, so it is passed in the URL *fragment*
// (e.g. `#passcode=abc123`) instead of the query string. Fragments are never
// sent to the server, so the passcode stays out of access logs and `Referer`
// headers. This has to run on the client: `router.query` (and the server)
// never see the fragment.
function readPasscodeFromHash(): string | undefined {
  // `window` is undefined during SSR — the fragment only exists on the client.
  // Returning undefined keeps the server render (a loading spinner) and the
  // initial client render in sync.
  if (typeof window === "undefined") return undefined;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return undefined;
  const value = new URLSearchParams(hash).get("passcode");
  return value ? value : undefined;
}

export function useUrlPasscode(): string | undefined {
  const router = useRouter();
  // Resolve the fragment synchronously on the first client render so a field
  // that should be locked (d=1) never briefly renders as unlocked/editable
  // before an effect could populate it.
  const [passcode, setPasscode] = useState<string | undefined>(
    readPasscodeFromHash,
  );

  useEffect(() => {
    // Re-read on client-side navigations (router path change) and manual
    // fragment edits (hashchange). Identical values are a no-op in React.
    setPasscode(readPasscodeFromHash());
    const handleHashChange = () => setPasscode(readPasscodeFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [router.asPath]);

  return passcode;
}
