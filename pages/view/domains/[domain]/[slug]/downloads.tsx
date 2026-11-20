import { GetServerSideProps } from "next";

import {
  type ViewerI18nPageProps,
  buildViewerI18nPageProps,
} from "@/lib/i18n/viewer-page-props";
import prisma from "@/lib/prisma";

import { DownloadsPanel } from "@/components/view/dataroom/downloads-panel";
import { ViewerI18nProvider } from "@/components/view/viewer-i18n-provider";

type Props = Partial<ViewerI18nPageProps> & { linkId: string };

export const getServerSideProps: GetServerSideProps<Props> = async (
  context,
) => {
  const domain = context.params?.domain as string;
  const slug = context.params?.slug as string;
  if (!domain || !slug) {
    return { notFound: true };
  }
  const link = await prisma.link.findUnique({
    where: {
      domainSlug_slug: { slug, domainSlug: domain },
    },
    select: {
      id: true,
      dataroom: { select: { brand: { select: { defaultLanguage: true } } } },
    },
  });
  if (!link) {
    return { notFound: true };
  }
  const i18nProps = await buildViewerI18nPageProps(
    link.dataroom?.brand ?? null,
  );
  return { props: { linkId: link.id, ...i18nProps } };
};

export default function DomainDownloadsPage(props: Props) {
  const locale = props.i18n?.locale ?? "en";
  const resources = props.i18n?.resources ?? {};
  return (
    <ViewerI18nProvider locale={locale} resources={resources}>
      <DownloadsPanel linkId={props.linkId} />
    </ViewerI18nProvider>
  );
}
