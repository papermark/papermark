import { Metadata } from "next";
import Link from "next/link";

import NotFound from "@/pages/404";
import { format } from "date-fns";
import { ClockIcon, MailIcon } from "lucide-react";

import prisma from "@/lib/prisma";
import { verifyJWT } from "@/lib/utils/generate-jwt";

import AcceptInvitationButton from "./AcceptInvitationButton";
import InvitationStatusContent from "./InvitationStatusContent";
import CleanUrlOnExpire from "./status/ClientRedirect";

const data = {
  description: "Accept your team invitation on Papermark",
  title: "Accept Invitation | Papermark",
  url: "/verify/invitation",
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

export default async function VerifyInvitationPage({
  searchParams,
}: {
  searchParams: {
    token?: string;
  };
}) {
  const { token: jwtToken } = searchParams;

  if (!jwtToken) {
    return <NotFound />;
  }

  // verify JWT token
  const payload = verifyJWT(jwtToken);

  if (!payload) {
    return <NotFound />;
  }

  const { verification_url, teamId, token, email, expiresAt } = payload;

  // Validate required parameters
  if (!verification_url || !teamId || !token || !email) {
    return <NotFound />;
  }
  const isExpired = expiresAt ? new Date() > new Date(expiresAt) : false;
  let isRevoked = false;
  if (!isExpired) {
    try {
      const invitation = await prisma.invitation.findUnique({
        where: {
          token: token,
        },
      });
      isRevoked = !invitation;
    } catch (error) {
      console.error("Error checking invitation status:", error);
    }
  }
  return (
    <>
      <CleanUrlOnExpire shouldClean={isExpired || isRevoked} />
      <div className="flex h-screen w-full flex-wrap">
        {/* Left part */}
        <div className="flex h-full w-full items-center justify-center bg-white md:w-1/2 lg:w-2/5">
          <div
            className="absolute inset-x-0 top-10 -z-10 flex transform-gpu justify-center overflow-hidden blur-3xl"
            aria-hidden="true"
          ></div>
          <div className="z-10 mx-auto h-fit w-full max-w-md overflow-hidden rounded-lg">
            <div className="flex flex-col items-center justify-center space-y-3 px-4 py-6 pt-8 text-center sm:px-16">
              <Link href="/">
                <span className="text-balance text-2xl font-semibold text-gray-800">
                  Welcome to Papermark
                </span>
              </Link>
              {!isExpired && !isRevoked && (
                <>
                  <h3 className="text-balance py-1 text-sm font-normal text-gray-800">
                    You&apos;ve been invited to join a team on Papermark
                  </h3>
                  <div className="mt-2 flex w-auto items-center justify-center gap-2 rounded-full bg-gray-50 px-5 py-2.5 text-sm text-gray-600 shadow-sm">
                    <MailIcon className="h-4 w-4 text-gray-400" />
                    {email}
                  </div>
                </>
              )}
            </div>

            {isRevoked || isExpired ? (
              <div className="px-4 py-6 sm:px-16">
                <InvitationStatusContent status={"expired"} />
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-4 px-4 pt-8 sm:px-16">
                  <div className="relative">
                    <AcceptInvitationButton
                      verificationUrl={verification_url}
                    />
                  </div>
                  {expiresAt ? (
                    <div className="text-center text-sm text-gray-500">
                      <p className="flex items-center justify-center gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-amber-700">
                        <ClockIcon className="h-4 w-4 text-amber-500" />
                        <span>
                          Expires on{" "}
                          <span className="font-medium">
                            {format(new Date(expiresAt), "MMM d, yyyy")}
                          </span>{" "}
                          at{" "}
                          <span className="font-medium">
                            {format(new Date(expiresAt), "h:mm a")}
                          </span>
                        </span>
                      </p>
                    </div>
                  ) : null}
                </div>
                <p className="mt-10 w-full max-w-md px-4 text-xs text-muted-foreground sm:px-16">
                  By accepting this invitation, you acknowledge that you have
                  read and agree to Papermark&apos;s{" "}
                  <a
                    href="https://www.papermark.com/terms"
                    target="_blank"
                    className="underline hover:text-gray-900"
                  >
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a
                    href="https://www.papermark.com/privacy"
                    target="_blank"
                    className="underline hover:text-gray-900"
                  >
                    Privacy Policy
                  </a>
                  .
                </p>
              </>
            )}
          </div>
        </div>
        {/* Right part */}
        <div className="hidden h-full w-full justify-center bg-gray-800 md:flex md:w-1/2 lg:w-3/5">
          <div className="flex w-full max-w-5xl px-4 py-20 md:px-8">
            <div
              className="mx-auto flex w-full max-w-5xl justify-center rounded-3xl bg-gray-800 px-4 py-20 md:px-8"
              id="features"
            >
              <div className="flex flex-col items-center justify-center">
                {/* Image container */}
                <div className="mb-4 h-64 w-64">
                  <img
                    className="h-full w-full rounded-2xl object-cover shadow-2xl"
                    src="/_static/testimonials/jaski.jpeg"
                    alt="Jaski"
                  />
                </div>
                {/* Text content */}
                <div className="max-w-xl text-center">
                  <blockquote className="text-l text-balance leading-8 text-gray-100 sm:text-xl sm:leading-9">
                    <p>
                      True builders listen to their users and build what they
                      need. Thanks Papermark team for solving a big pain point.
                      DocSend monopoly will end soon!
                    </p>
                  </blockquote>
                  <figcaption className="mt-4">
                    <div className="text-balance font-semibold text-white">
                      Jaski
                    </div>
                    <div className="text-balance text-gray-400">
                      Founder, Townhall Network
                    </div>
                  </figcaption>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
