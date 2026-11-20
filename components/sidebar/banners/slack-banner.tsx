import { useRouter } from "next/router";

import { Dispatch, SetStateAction } from "react";

import Cookies from "js-cookie";

import { useAnalytics } from "@/lib/analytics";

import { SlackIcon } from "@/components/shared/icons/slack-icon";
import X from "@/components/shared/icons/x";

export default function SlackBanner({
  setShowSlackBanner,
}: {
  setShowSlackBanner: Dispatch<SetStateAction<boolean | null>>;
}) {
  const router = useRouter();
  const analytics = useAnalytics();

  const handleHideBanner = () => {
    setShowSlackBanner(false);
    Cookies.set("hideSlackBanner", "slack-banner", {
      expires: 30, // Hide for 30 days
    });
  };

  const handleConnectSlack = () => {
    analytics.capture("Slack Connect Button Clicked", {
      source: "slack_banner",
      location: "sidebar",
    });
    router.push("/settings/slack");
  };

  return (
    <aside className="relative mb-2 flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-background px-3 py-2 text-foreground">
      <SlackIcon className="h-4 w-4 shrink-0" />
      <span className="grow text-sm text-foreground">Connect Slack</span>
      <button
        type="button"
        onClick={handleConnectSlack}
        className="shrink-0 rounded-sm text-sm font-medium text-foreground ring-offset-background transition-colors hover:text-foreground/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Set up
      </button>
      <button
        type="button"
        onClick={handleHideBanner}
        className="shrink-0 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </button>
    </aside>
  );
}
