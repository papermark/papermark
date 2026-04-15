"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { useState } from "react";

import { AlertCircle } from "lucide-react";

import { SSOLogin } from "@/ee/features/security/sso";
import { signInWithPasskey } from "@teamhanko/passkeys-next-auth-provider/client";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { z } from "zod";

import { cn } from "@/lib/utils";

import { LastUsed, useLastUsed } from "@/components/hooks/useLastUsed";
import Google from "@/components/shared/icons/google";
import LinkedIn from "@/components/shared/icons/linkedin";
import Passkey from "@/components/shared/icons/passkey";
import { LogoCloud } from "@/components/shared/logo-cloud";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { next } = useParams as { next?: string };
  const router = useRouter();
  const searchParams = useSearchParams();
  const authError = searchParams?.get("error");
  const isSSORequired = authError === "require-saml-sso";

  const [lastUsed, setLastUsed] = useLastUsed();
  const authMethods = ["google", "email", "linkedin", "passkey"] as const;
  type AuthMethod = (typeof authMethods)[number];
  const [clickedMethod, setClickedMethod] = useState<AuthMethod | undefined>(
    undefined,
  );
  const [email, setEmail] = useState<string>("");
  const [emailButtonText, setEmailButtonText] = useState<string>(
    "Continue with Email",
  );

  const emailSchema = z
    .string()
    .trim()
    .toLowerCase()
    .min(3, { message: "Please enter a valid email." })
    .email({ message: "Please enter a valid email." });

  const emailValidation = emailSchema.safeParse(email);

  return (
    <div className="flex h-screen w-full flex-wrap">
      {/* Left part */}
      <div className="flex w-full justify-center bg-white md:w-[55%] lg:w-[55%]">
        <div className="z-10 mx-5 mt-0 h-fit w-full max-w-md overflow-hidden sm:mx-0 sm:mt-[calc(0.5vh)] md:mt-[calc(1vh)]">
          <div className="items-left flex flex-col space-y-3 px-4 py-6 pt-5 sm:px-12 sm:pt-6">
            <Link href="https://www.papermark.com" target="_blank">
              <img
                src="/_static/papermark-logo.svg"
                alt="Papermark Logo"
                className="mb-24 h-7 w-auto self-start sm:mb-20"
              />
            </Link>
            <Link href="/">
              <span className="text-balance text-3xl font-semibold text-gray-900">
                Welcome to Papermark
              </span>
            </Link>
            <h3 className="text-balance text-sm text-gray-800">
              Share documents. Not attachments.
            </h3>
          </div>
          {isSSORequired && (
            <div className="mx-4 mb-2 flex items-start gap-3 rounded-[4px] border border-orange-200 bg-orange-50 px-4 py-3 sm:mx-12">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600" />
              <div>
                <p className="text-sm font-medium text-orange-900">
                  Your organization requires SSO login
                </p>
                <p className="mt-1 text-sm text-orange-700">
                  Please use the <strong>SAML SSO</strong> option below to sign
                  in with your company&apos;s identity provider.
                </p>
              </div>
            </div>
          )}
          <form
            className="flex flex-col gap-4 px-4 pt-4 sm:px-12"
            onSubmit={(e) => {
              e.preventDefault();
              if (!emailValidation.success) {
                toast.error(emailValidation.error.errors[0].message);
                return;
              }

              setClickedMethod("email");
              signIn("email", {
                email: emailValidation.data,
                redirect: false,
                ...(next && next.length > 0 ? { callbackUrl: next } : {}),
              }).then((res) => {
                if (res?.ok && !res?.error) {
                  setLastUsed("credentials");
                  // Store email in sessionStorage for the verification page
                  try {
                    sessionStorage.setItem(
                      "pendingVerificationEmail",
                      emailValidation.data,
                    );
                  } catch {
                    // sessionStorage not available, verification page will show email input
                  }
                  router.push("/auth/email");
                } else {
                  setEmailButtonText("Error sending email - try again?");
                  toast.error("Error sending email - try again?");
                  setClickedMethod(undefined);
                }
              });
            }}
          >
            <Label className="sr-only" htmlFor="email">
              Email
            </Label>
            <Input
              id="email"
              placeholder="name@example.com"
              type="email"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect="off"
              disabled={clickedMethod === "email"}
              // pattern={patternSimpleEmailRegex}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cn(
                "flex h-10 w-full rounded-[4px] border-0 bg-background bg-white px-3 py-2 text-sm text-gray-900 ring-1 ring-gray-200 transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white",
                email.length > 0 && !emailValidation.success
                  ? "ring-red-500"
                  : "ring-gray-200",
              )}
            />
            <div className="relative">
              <Button
                type="submit"
                loading={clickedMethod === "email"}
                disabled={!emailValidation.success || !!clickedMethod}
                className={cn(
                  "focus:shadow-outline w-full transform rounded-[4px] px-4 py-2 text-white transition-colors duration-300 ease-in-out focus:outline-none disabled:opacity-100",
                  "bg-black hover:bg-gray-900",
                )}
              >
                {emailButtonText}
              </Button>
              {lastUsed === "credentials" && <LastUsed />}
            </div>
          </form>
          <p className="py-4 text-center">or</p>
          <div className="flex flex-col space-y-2 px-4 sm:px-12">
            <div className="relative">
              <Button
                onClick={() => {
                  setClickedMethod("google");
                  setLastUsed("google");
                  signIn("google", {
                    ...(next && next.length > 0 ? { callbackUrl: next } : {}),
                  }).then((res) => {
                    setClickedMethod(undefined);
                  });
                }}
                loading={clickedMethod === "google"}
                disabled={clickedMethod && clickedMethod !== "google"}
                className="flex w-full items-center justify-center space-x-2 border border-gray-300 bg-gray-100 font-normal text-gray-900 hover:bg-gray-200"
              >
                <Google className="h-5 w-5" />
                <span>Continue with Google</span>
                {clickedMethod !== "google" && lastUsed === "google" && (
                  <LastUsed />
                )}
              </Button>
            </div>
            <div className="relative">
              <Button
                onClick={() => {
                  setClickedMethod("linkedin");
                  setLastUsed("linkedin");
                  signIn("linkedin", {
                    ...(next && next.length > 0 ? { callbackUrl: next } : {}),
                  }).then((res) => {
                    setClickedMethod(undefined);
                  });
                }}
                loading={clickedMethod === "linkedin"}
                disabled={clickedMethod && clickedMethod !== "linkedin"}
                className="flex w-full items-center justify-center space-x-2 border border-gray-300 bg-gray-100 font-normal text-gray-900 hover:bg-gray-200"
              >
                <LinkedIn />
                <span>Continue with LinkedIn</span>
                {clickedMethod !== "linkedin" && lastUsed === "linkedin" && (
                  <LastUsed />
                )}
              </Button>
            </div>
            <div className="relative">
              <Button
                onClick={() => {
                  setLastUsed("passkey");
                  setClickedMethod("passkey");
                  signInWithPasskey({
                    tenantId: process.env.NEXT_PUBLIC_HANKO_TENANT_ID as string,
                  }).then(() => {
                    setClickedMethod(undefined);
                  });
                }}
                variant="outline"
                loading={clickedMethod === "passkey"}
                disabled={clickedMethod && clickedMethod !== "passkey"}
                className="flex w-full items-center justify-center space-x-2 border border-gray-300 bg-gray-100 font-normal text-gray-900 hover:bg-gray-200 hover:text-gray-900"
              >
                <Passkey className="h-4 w-4" />
                <span>Continue with a passkey</span>
                {lastUsed === "passkey" && <LastUsed />}
              </Button>
            </div>
            <div className="relative">
              <SSOLogin autoExpand={isSSORequired} />
            </div>
          </div>
          <p className="mt-10 w-full max-w-md px-4 text-xs text-muted-foreground sm:px-12">
            By continuing, you agree to Papermark&apos;s{" "}
            <a
              href="https://www.papermark.com/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href="https://www.papermark.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
      <div
        className="relative hidden w-full justify-center overflow-hidden md:flex md:w-[45%] lg:w-[45%]"
        style={{ backgroundColor: "#f9fafb" }}
      >
        <div className="flex h-full w-full flex-col items-center justify-center px-4 py-10">
          <div className="flex w-full max-w-xl flex-col items-center">
            <div className="mb-6 w-full max-w-md">
              <img
                className="h-auto w-full rounded-[4px] object-cover "
                src="/_static/testimonials/backtrace.jpeg"
                alt="Backtrace Capital"
              />
            </div>
            <div className="w-full max-w-3xl text-center">
              <blockquote
                className="leading-8 text-gray-900 sm:text-xl sm:leading-9"
                style={{
                  fontFamily:
                    "system-ui, 'Helvetica Neue', Helvetica, Arial, sans-serif",
                }}
              >
                <p>
                  &quot;We raised €50M Fund with Papermark Data Rooms.
                  <br />
                  Secure, branded, and incredibly easy to use.&quot;
                </p>
              </blockquote>
              <figcaption className="mt-4">
                <div className="text-balance font-medium text-gray-900">
                  Michael Münnix
                </div>
                <div className="text-balance font-light text-gray-500">
                  Partner, Backtrace Capital
                </div>
              </figcaption>
            </div>
          </div>
          <div className="mt-20 flex w-full max-w-md flex-col items-center">
            <LogoCloud />
          </div>
        </div>
      </div>
    </div>
  );
}
