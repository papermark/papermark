import Link from "next/link";

import { useState } from "react";

import { BarChart } from "@tremor/react";
import { motion } from "motion/react";
import { signIn } from "next-auth/react";

import { useAnalytics } from "@/lib/analytics";
import { STAGGER_CHILD_VARIANTS } from "@/lib/constants";

import { timeFormatter } from "../charts/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

function formatTotalDuration(totalDuration: number | null | undefined): string {
  if (totalDuration == null) {
    return "0 minutes"; // Default value if total_duration is null
  } else if (totalDuration < 60000) {
    return "< 1 minute";
  } else {
    const minutes = Math.ceil(totalDuration / 60000);
    return `${minutes} minutes`;
  }
}

function sumDurationsAndFormat(
  pages: {
    pageNumber: number;
    duration: number;
  }[],
): string {
  const totalDuration = pages.reduce((sum, page) => sum + page.duration, 0);
  return formatTotalDuration(totalDuration);
}

export default function ViewDurationSummary({
  linkId,
  viewedPages,
  viewerEmail,
  accountCreated,
  setAccountCreated,
}: {
  linkId: string;
  viewedPages: { pageNumber: number; duration: number }[];
  viewerEmail?: string;
  accountCreated: boolean;
  setAccountCreated: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [email, setEmail] = useState<string>(viewerEmail || "");
  const [loading, setLoading] = useState<boolean>(false);

  const analytics = useAnalytics();

  if (accountCreated) {
    return (
      <motion.div
        className="mx-5 flex h-full flex-col items-center justify-center space-y-10 text-center sm:mx-auto"
        variants={{
          hidden: { opacity: 0, scale: 0.95 },
          show: {
            opacity: 1,
            scale: 1,
            transition: {
              staggerChildren: 0.2,
            },
          },
        }}
        initial="hidden"
        animate="show"
        exit="hidden"
        transition={{ duration: 0.3, type: "spring" }}
      >
        <motion.div
          variants={STAGGER_CHILD_VARIANTS}
          className="flex flex-col items-center space-y-10 text-center"
        >
          <h1 className="max-w-lg text-3xl font-semibold text-white transition-colors">
            Thanks for creating an account!
          </h1>
          <p className="max-w-lg text-balance text-white">
            We sent you an email confirmation with a link to your Papermark
            account.
          </p>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="flex h-full w-full flex-col items-center justify-center space-y-10 text-center"
      variants={{
        hidden: { opacity: 0, scale: 0.95 },
        show: {
          opacity: 1,
          scale: 1,
          transition: {
            staggerChildren: 0.2,
          },
        },
      }}
      initial="hidden"
      animate="show"
      exit="hidden"
      transition={{ duration: 0.3, type: "spring" }}
    >
      <motion.div
        variants={STAGGER_CHILD_VARIANTS}
        className="mx-5 h-fit w-full max-w-md overflow-hidden rounded-md bg-white py-6 text-white sm:mx-0"
      >
        <motion.div
          variants={STAGGER_CHILD_VARIANTS}
          className="flex flex-col items-center space-y-10 text-center"
        >
          <div className="flex flex-col items-center justify-center space-y-3 px-4 py-6 pt-8 text-center sm:px-16">
            <div className="text-balance text-base text-muted-foreground">
              You spent {sumDurationsAndFormat(viewedPages)} on this document.
            </div>
            <BarChart
              className="h-40"
              data={viewedPages}
              index="pageNumber"
              categories={["duration"]}
              colors={["emerald"]}
              valueFormatter={(v) => timeFormatter(v)}
              showYAxis={false}
              showGridLines={true}
              showLegend={false}
            />
          </div>
        </motion.div>
        <motion.div variants={STAGGER_CHILD_VARIANTS}>
          <div className="flex flex-col items-center justify-center space-y-3 px-4 py-6 pt-8 text-center sm:px-16">
            <div className="text-balance text-2xl font-semibold text-gray-800">
              Start sharing documents and data rooms securely
            </div>
          </div>
          <form
            className="flex flex-col gap-4 px-4 sm:px-16"
            onSubmit={(e) => {
              e.preventDefault();
              setLoading(true);
              signIn("email", {
                email: email,
                redirect: false,
                callbackUrl: `/dashboard`,
              }).then((res) => {
                if (res?.ok && !res?.error) {
                  setEmail("");
                  setAccountCreated(true);
                  analytics.capture("Account Created", {
                    email: email,
                    linkId: linkId,
                    timeSpent: viewedPages.reduce(
                      (sum, page) => sum + page.duration,
                      0,
                    ),
                  });
                }
                setLoading(false);
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
              data-1p-ignore
              disabled={loading}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex h-10 w-full rounded-md border-0 bg-background bg-white px-3 py-2 text-sm text-gray-900 ring-1 ring-gray-200 transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            <Button
              type="submit"
              loading={loading}
              className={`${
                loading ? "bg-black" : "bg-gray-800 hover:bg-gray-900"
              } focus:shadow-outline transform rounded px-4 py-2 text-white transition-colors duration-300 ease-in-out focus:outline-none`}
            >
              Sign up with Email
            </Button>
          </form>
          <p className="mt-4 w-full max-w-md px-4 text-xs text-muted-foreground sm:px-16">
            By clicking continue, you acknowledge that you have read and agree
            to Papermark&apos;s{" "}
            <Link
              href="https://www.papermark.com/terms"
              target="_blank"
              className="underline hover:text-gray-900"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="https://www.papermark.com/privacy"
              target="_blank"
              className="underline hover:text-gray-900"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
