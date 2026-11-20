import { Metadata } from "next";
import { redirect } from "next/navigation";

import NotFound from "@/pages/404";
import { VerificationToken } from "@prisma/client";
import { waitUntil } from "@vercel/functions";

import { hashToken } from "@/lib/api/auth/token";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { sendEmail, subscribe, unsubscribe } from "@/lib/resend";
import { CustomUser } from "@/lib/types";

import EmailUpdated from "@/components/emails/email-updated";

import ConfirmEmailChangePageClient from "./page-client";
import { getSession } from "./utils";

export const runtime = "nodejs";

const data = {
  description: "Confirm email change",
  title: "Confirm email change | Papermark",
  url: "/auth/confirm-email-change",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://www.papermark.com"),
  title: data.title,
  description: data.description,
  openGraph: {
    title: data.title,
    description: data.description,
    url: data.url,
    siteName: "Papermark",
    images: [
      {
        url: "/_static/meta-image.png",
        width: 800,
        height: 600,
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: data.title,
    description: data.description,
    creator: "@papermarkio",
    images: ["/_static/meta-image.png"],
  },
};

interface PageProps {
  params: { token: string };
}

export default async function ConfirmEmailChangePage(props: PageProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 text-center">
      <VerifyEmailChange {...props} />
    </div>
  );
}

const VerifyEmailChange = async ({ params: { token } }: PageProps) => {
  const tokenFound = await prisma.verificationToken.findUnique({
    where: {
      token: hashToken(token),
    },
  });

  if (!tokenFound || tokenFound.expires < new Date()) return <NotFound />;

  const session = await getSession();

  if (!session) {
    redirect(`/login?next=/auth/confirm-email-change/${token}`);
  }

  const currentUserId = (session.user as CustomUser).id;
  const tokenUserId = tokenFound.identifier;

  if (tokenUserId !== currentUserId) return <NotFound />;

  const data = await redis.get<{ email: string; newEmail: string }>(
    `email-change-request:user:${tokenUserId}`,
  );

  if (!data) return <NotFound />;

  await unsubscribe(data.email);

  await prisma.user.update({
    where: {
      id: tokenUserId,
    },
    data: {
      email: data.newEmail,
    },
  });

  waitUntil(
    Promise.all([
      deleteRequest(tokenFound),

      subscribe(data.newEmail),

      sendEmail({
        to: data.email,
        subject: "Your email address has been changed",
        system: true,
        react: EmailUpdated({
          oldEmail: data.email,
          newEmail: data.newEmail,
        }),
        test: process.env.NODE_ENV === "development",
      }),
    ]),
  );

  return <ConfirmEmailChangePageClient />;
};

const deleteRequest = async (tokenFound: VerificationToken) => {
  await Promise.all([
    prisma.verificationToken.delete({
      where: {
        token: tokenFound.token,
      },
    }),

    redis.del(`email-change-request:user:${tokenFound.identifier}`),
  ]);
};
