import { GetServerSideProps } from "next";
import { useRouter } from "next/router";

import { Loader2 } from "lucide-react";

import {
  type ViewerI18nPageProps,
  buildViewerI18nPageProps,
} from "@/lib/i18n/viewer-page-props";
import prisma from "@/lib/prisma";

import { DownloadsPanel } from "@/components/view/dataroom/downloads-panel";
import { ViewerI18nProvider } from "@/components/view/viewer-i18n-provider";

type Props = Partial<ViewerI18nPageProps> & { linkId: string | null };

export const getServerSideProps: GetServerSideProps<Props> = async (
  context,
) => {
  const linkId = context.params?.linkId as string;
  let link: {
    dataroom: { brand: { defaultLanguage: string | null } | null } | null;
  } | null = null;

  // Re-resolve the link's dataroom-brand default language so this page renders
  // in the same locale as the dataroom it was opened from.
  try {
    if (linkId) {
      link = await prisma.link.findUnique({
        where: { id: linkId },
        select: {
          dataroom: {
            select: { brand: { select: { defaultLanguage: true } } },
          },
        },
      });
    }
  } catch {
    link = null;
  }

  try {
    const i18nProps = await buildViewerI18nPageProps(
      link?.dataroom?.brand ?? null,
    );
    return { props: { linkId: linkId ?? null, ...i18nProps } };
  } catch {
    return { props: { linkId: linkId ?? null } };
  }
};

function ViewDownloadsPageInner({ linkId: linkIdProp }: Props) {
  const router = useRouter();
  const linkId = (router.query.linkId as string) ?? linkIdProp ?? undefined;

  if (!linkId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <DownloadsPanel linkId={linkId} />;
}

export default function ViewDownloadsPage(props: Props) {
  const locale = props.i18n?.locale ?? "en";
  const resources = props.i18n?.resources ?? {};
  return (
    <ViewerI18nProvider locale={locale} resources={resources}>
      <ViewDownloadsPageInner {...props} />
    </ViewerI18nProvider>
  );
}
