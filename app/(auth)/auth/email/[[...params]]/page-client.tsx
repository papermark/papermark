"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useEffect, useRef, useState } from "react";

import { LogoCloud } from "@/components/shared/logo-cloud";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function EmailVerificationClient() {
  const router = useRouter();
  const codeInputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [emailLocked, setEmailLocked] = useState(false);
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    try {
      const pendingEmail = sessionStorage.getItem("pendingVerificationEmail");
      if (pendingEmail) {
        setEmail(pendingEmail);
        setEmailLocked(true);
        sessionStorage.removeItem("pendingVerificationEmail");
        setTimeout(() => {
          codeInputRef.current?.focus();
        }, 100);
      }
    } catch {
      // sessionStorage not available
    }
  }, []);

  // Code verification
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: code.trim().toUpperCase(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (
          response.status === 410 ||
          response.status === 401 ||
          data.error?.includes("expired") ||
          data.error?.includes("Invalid code")
        ) {
          setIsExpired(true);
          setError("This code has expired or is invalid.");
        } else if (response.status === 429) {
          setError(
            data.error || "Too many attempts. Please wait before trying again.",
          );
        } else {
          setError(data.error || "Verification failed. Please try again.");
        }
        setIsLoading(false);
        return;
      }

      // Redirect to the callback URL
      if (data.callbackUrl) {
        router.push(data.callbackUrl);
      } else {
        // No callback URL in response - stop loading and show error
        setIsLoading(false);
        setError("Unable to complete sign-in: missing callback URL. Please try again.");
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  if (isExpired) {
    return (
      <div className="flex h-screen w-full flex-wrap">
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
              <span className="text-balance text-3xl font-semibold text-gray-900">
                Code Expired
              </span>
              <h3 className="text-balance text-sm text-gray-800">
                This login code has expired or has already been used.
              </h3>
            </div>
            <div className="flex flex-col gap-4 px-4 pt-4 sm:px-12">
              <Link href="/login">
                <Button className="focus:shadow-outline w-full transform rounded-[4px] bg-black px-4 py-2 text-white transition-colors duration-300 ease-in-out hover:bg-gray-900 focus:outline-none">
                  Request a new code
                </Button>
              </Link>
            </div>
          </div>
        </div>
        <TestimonialSection />
      </div>
    );
  }

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
                Check your email
              </span>
            </Link>
            <h3 className="text-balance text-sm text-gray-800">
              {emailLocked ? (
                <>
                  We sent a login code to{" "}
                  <span className="font-medium">{email}</span>
                </>
              ) : (
                "Enter your email and the code we sent you"
              )}
            </h3>
          </div>

          <form
            className="flex flex-col gap-4 px-4 pt-4 sm:px-12"
            onSubmit={handleSubmit}
          >
            {!emailLocked && (
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  placeholder="name@example.com"
                  type="email"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect="off"
                  disabled={isLoading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex h-10 w-full rounded-[4px] border-0 bg-background bg-white px-3 py-2 text-sm text-gray-900 ring-1 ring-gray-200 transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="code">Verification Code</Label>
              <Input
                ref={codeInputRef}
                id="code"
                placeholder="Enter 10-character code"
                type="text"
                autoCapitalize="characters"
                autoComplete="one-time-code"
                autoCorrect="off"
                disabled={isLoading}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={10}
                className="flex h-10 w-full rounded-[4px] border-0 bg-background bg-white px-3 py-2 font-mono text-lg tracking-widest text-gray-900 ring-1 ring-gray-200 transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground placeholder:font-sans placeholder:text-sm placeholder:tracking-normal focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}

            <Button
              type="submit"
              loading={isLoading}
              disabled={isLoading || !email || code.length < 10}
              className="focus:shadow-outline w-full transform rounded-[4px] bg-black px-4 py-2 text-white transition-colors duration-300 ease-in-out hover:bg-gray-900 focus:outline-none disabled:opacity-100"
            >
              Verify
            </Button>
          </form>

          <p className="mt-6 px-4 text-center text-sm text-muted-foreground sm:px-12">
            Didn&apos;t receive a code?{" "}
            <Link href="/login" className="text-gray-900 underline">
              Try again
            </Link>
          </p>

          <p className="mt-10 w-full max-w-md px-4 text-xs text-muted-foreground sm:px-12">
            By continuing, you agree to Papermark&apos;s{" "}
            <a
              href="https://www.papermark.com/terms"
              target="_blank"
              className="underline"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href="https://www.papermark.com/privacy"
              target="_blank"
              className="underline"
            >
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
      <TestimonialSection />
    </div>
  );
}

function TestimonialSection() {
  return (
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
  );
}
