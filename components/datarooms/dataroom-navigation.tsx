import useLimits from "@/lib/swr/use-limits";

import { NavMenu } from "../navigation-menu";

export const DataroomNavigation = ({ dataroomId }: { dataroomId?: string }) => {
  const { limits } = useLimits();
  if (!dataroomId) {
    return null;
  }
  return (
    <NavMenu
      navigation={[
        {
          label: "Data Room",
          href: `/datarooms/${dataroomId}/documents`,
          segment: "documents",
        },
        {
          label: "Permissions",
          href: `/datarooms/${dataroomId}/permissions`,
          segment: "permissions",
        },
        {
          label: "Participants",
          href: `/datarooms/${dataroomId}/participants`,
          segment: "participants",
        },
        {
          label: "Analytics",
          href: `/datarooms/${dataroomId}/analytics`,
          segment: "analytics",
        },
        {
          label: "Q&A",
          href: `/datarooms/${dataroomId}/conversations`,
          segment: "conversations",
          limited: !limits?.conversationsInDataroom,
        },
        {
          label: "Branding",
          href: `/datarooms/${dataroomId}/branding`,
          segment: "branding",
        },
        {
          label: "Settings",
          href: `/datarooms/${dataroomId}/settings`,
          segment: "settings",
        },
      ]}
    />
  );
};
