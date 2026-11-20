import { useCallback, useEffect, useRef, useState } from "react";

import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileArchive,
  FolderOpen,
  Loader2,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DownloadOtpVerification } from "@/components/view/dataroom/download-otp-verification";

type Job = {
  id: string;
  status: string;
  phase?: "VALIDATING" | "BUILDING" | "ZIPPING";
  progress: number;
  totalFiles: number;
  processedFiles: number;
  downloadUrls?: string[];
  error?: string;
  dataroomName: string;
  type?: "bulk" | "folder";
  folderName?: string;
  createdAt: string;
  expiresAt?: string;
};

function getJobStatusLabel(job: Job, t: TFunction<"dataroom">): string {
  if (job.status === "COMPLETED") return t("downloadsPanel.ready", "Ready");
  if (job.status === "FAILED")
    return job.error || t("downloadsPanel.failedFallback", "Failed");
  if (job.status === "PROCESSING") {
    if (job.totalFiles > 0) {
      return t("downloadsPanel.filesCount", "{{processed}} / {{total}} files", {
        processed: job.processedFiles,
        total: job.totalFiles,
      });
    }
    return t("downloadsPanel.creatingZip", "Creating ZIP...");
  }
  // PENDING — break out the sub-phase so users see meaningful progress.
  switch (job.phase) {
    case "VALIDATING":
      return t("downloadsPanel.verifying", "Verifying access...");
    case "BUILDING":
      return t("downloadsPanel.buildingFileList", "Building file list...");
    default:
      return t("downloadsPanel.preparing", "Preparing...");
  }
}

const POLL_INTERVAL_MS = 5_000;

export function DownloadsPanel({ linkId }: { linkId: string }) {
  const { t } = useTranslation("dataroom");
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"session" | "email" | "otp" | "list">(
    "session",
  );
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{
    jobId: string;
    current: number;
    total: number;
  } | null>(null);

  // ── Session check ──────────────────────────────────────────────────
  const checkSession = useCallback(async () => {
    if (!linkId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/links/download/verify?linkId=${encodeURIComponent(linkId)}`,
        { credentials: "include" },
      );
      if (res.ok) {
        setHasSession(true);
        setStep("list");
        return;
      }
      setHasSession(false);
      setStep("email");
    } catch {
      setHasSession(false);
      setStep("email");
    } finally {
      setLoading(false);
    }
  }, [linkId]);

  useEffect(() => {
    if (!linkId) return;
    checkSession();
  }, [linkId, checkSession]);

  // ── Fetch jobs ─────────────────────────────────────────────────────
  const fetchJobs = useCallback(async () => {
    if (!linkId) return;
    setJobsLoading(true);
    try {
      const res = await fetch(
        `/api/links/download/jobs?linkId=${encodeURIComponent(linkId)}`,
        { credentials: "include" },
      );
      if (res.ok) {
        const data = await res.json();
        setJobs(Array.isArray(data) ? data : []);
      } else {
        setJobs([]);
      }
    } catch {
      setJobs([]);
    } finally {
      setJobsLoading(false);
    }
  }, [linkId]);

  // Initial fetch when step transitions to "list"
  useEffect(() => {
    if (step === "list" && linkId) {
      fetchJobs();
    }
  }, [step, linkId, fetchJobs]);

  // ── Polling while jobs are in-flight ───────────────────────────────
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Only poll when we're on the list view
    if (step !== "list") return;

    const hasInFlightJobs = jobs.some(
      (j) => j.status === "PROCESSING" || j.status === "PENDING",
    );

    if (hasInFlightJobs) {
      // Start polling if not already running
      if (!intervalRef.current) {
        intervalRef.current = setInterval(() => {
          fetchJobs();
        }, POLL_INTERVAL_MS);
      }
    } else {
      // Stop polling when nothing is in-flight
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [step, jobs, fetchJobs]);

  // ── Email submit — send OTP directly (view is resolved server-side) ─
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkId || !email.trim()) return;
    setError(null);
    setEmailSubmitting(true);
    try {
      const res = await fetch(`/api/links/download/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          linkId,
          email: email.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setError(t("downloadsPage.errors.noAccess", "No access found for this email. Use the email you used to open the dataroom."));
        return;
      }
      if (res.status === 429) {
        setError(data.error ?? t("downloadsPage.errors.rateLimit", "Too many requests. Please try again later."));
        return;
      }
      if (!res.ok) {
        setError(data.error ?? t("downloadsPage.errors.generic", "Something went wrong."));
        return;
      }
      // OTP sent successfully — move to verification step
      setStep("otp");
    } catch {
      setError(t("downloadsPage.errors.generic", "Something went wrong."));
    } finally {
      setEmailSubmitting(false);
    }
  };

  // ── OTP verified ───────────────────────────────────────────────────
  const handleOtpVerified = () => {
    setHasSession(true);
    setStep("list");
  };

  // ── Download helpers ───────────────────────────────────────────────
  const handleDownload = (url: string) => {
    // Ensure we use a relative path so the request goes to the current origin
    // (where the session cookie lives), not a potentially different subdomain.
    let href = url;
    try {
      const parsed = new URL(url, window.location.origin);
      href = parsed.pathname + parsed.search;
    } catch {
      // url is already relative, use as-is
    }
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 100);
  };

  const handleDownloadAll = async (jobId: string, urls: string[]) => {
    if (downloadProgress) return;
    setDownloadProgress({ jobId, current: 0, total: urls.length });
    for (let i = 0; i < urls.length; i++) {
      setDownloadProgress({ jobId, current: i + 1, total: urls.length });
      handleDownload(urls[i]);
      if (i < urls.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    setDownloadProgress(null);
  };

  // ── Formatters ─────────────────────────────────────────────────────
  const formatExpiration = (expiresAt?: string) => {
    if (!expiresAt) return "";
    const exp = new Date(expiresAt);
    const now = new Date();
    if (exp.getTime() <= now.getTime()) return t("downloadsPage.expired", "expired");
    const d = Math.floor(
      (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    // i18next handles `_one` vs `_other` plural keys via the `count` arg.
    if (d > 0) return t("download.expiresDays", "{{count}} days", { count: d });
    const h = Math.floor(
      (exp.getTime() - now.getTime()) / (1000 * 60 * 60),
    );
    return h > 0
      ? t("download.expiresHours", "{{count}} hours", { count: h })
      : t("download.expiresSoon", "soon");
  };

  const getJobTitle = (job: Job) => {
    if (job.type === "folder" && job.folderName) {
      return (
        <>
          <span className="font-medium">{job.dataroomName}</span>
          <span className="text-muted-foreground">
            {" "}
            — <FolderOpen className="mr-0.5 inline h-3.5 w-3" />
            {t("downloadsPage.jobFolderPrefix", "Folder:")} {job.folderName}
          </span>
        </>
      );
    }
    return (
      <>
        <span className="font-medium">{job.dataroomName}</span>
        {job.type === "bulk" && (
          <span className="text-muted-foreground">
            {" "}
            — {t("downloadsPage.jobFullDataroom", "Full dataroom")}
          </span>
        )}
      </>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (step === "email") {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
        <h1 className="text-xl font-semibold">
          {t("downloadsPage.emailHeading", "View your downloads")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("downloadsPage.emailDescription", "Enter the email you used to access this dataroom.")}
        </p>
        <form onSubmit={handleEmailSubmit} className="mt-6 space-y-4">
          <Input
            type="email"
            placeholder={t("downloadsPage.emailPlaceholder", "you@example.com")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={emailSubmitting}>
            {emailSubmitting
              ? t("downloadsPage.sendingCode", "Sending code...")
              : t("downloadsPage.continueButton", "Continue")}
          </Button>
        </form>
      </div>
    );
  }

  if (step === "otp") {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
        <h1 className="text-xl font-semibold">
          {t("downloadsPage.verifyEmailHeading", "Verify your email")}
        </h1>
        <DownloadOtpVerification
          linkId={linkId}
          email={email.trim()}
          onVerified={handleOtpVerified}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10">
      <h1 className="text-xl font-semibold">{t("downloadsPage.title", "Your downloads")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("downloadsPage.description", "Download your prepared files below. Links expire after 3 days.")}
      </p>

      {jobsLoading && jobs.length === 0 ? (
        <div className="mt-8 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : jobs.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {t("downloadsPage.empty", "You have no downloads yet. Start a download from the dataroom to see it here.")}
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex flex-col gap-2 rounded-lg border p-4"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1 text-sm">
                  {getJobTitle(job)}
                </div>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                  {new Date(job.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {job.status === "COMPLETED" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                ) : job.status === "PROCESSING" || job.status === "PENDING" ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <FileArchive className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="text-muted-foreground">
                  {getJobStatusLabel(job, t)}
                </span>
              </div>
              {job.status === "COMPLETED" &&
                job.downloadUrls &&
                job.downloadUrls.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {job.downloadUrls.length === 1 ? (
                      <Button
                        size="sm"
                        onClick={() => handleDownload(job.downloadUrls![0])}
                      >
                        <Download className="mr-1 h-3 w-3" />
                        {t("cards.download", "Download")}
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setExpandedJobId(
                              expandedJobId === job.id ? null : job.id,
                            )
                          }
                        >
                          {expandedJobId === job.id ? (
                            <>
                              <ChevronUp className="mr-1 h-3 w-3" />
                              {t("downloadsPage.hideParts", "Hide parts")}
                            </>
                          ) : (
                            <>
                              <ChevronDown className="mr-1 h-3 w-3" />
                              {t("downloadsPage.showParts", "Show parts ({{count}})", {
                                count: job.downloadUrls!.length,
                              })}
                            </>
                          )}
                        </Button>
                        {expandedJobId === job.id && (
                          <div className="w-full space-y-2 rounded-md border bg-muted/30 p-3">
                            <Button
                              size="sm"
                              className="w-full"
                              disabled={!!downloadProgress}
                              onClick={() =>
                                handleDownloadAll(job.id, job.downloadUrls!)
                              }
                            >
                              {downloadProgress?.jobId === job.id ? (
                                <>
                                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                  {t("download.downloadingProgress", "Downloading {{current}} of {{total}}...", {
                                    current: downloadProgress.current,
                                    total: downloadProgress.total,
                                  })}
                                </>
                              ) : (
                                <>
                                  <Download className="mr-2 h-3 w-3" />
                                  {t("download.downloadAll", "Download all ({{count}} parts)", {
                                    count: job.downloadUrls!.length,
                                  })}
                                </>
                              )}
                            </Button>
                            <p className="text-xs text-muted-foreground">
                              {t("downloadsPage.orIndividual", "Or download individually:")}
                            </p>
                            <div className="max-h-32 space-y-1 overflow-y-auto">
                              {job.downloadUrls!.map((url, i) => (
                                <Button
                                  key={i}
                                  variant="outline"
                                  size="sm"
                                  className="w-full justify-start"
                                  onClick={() => handleDownload(url)}
                                >
                                  <FileArchive className="mr-2 h-3 w-3" />
                                  {t("downloadsPage.partOf", "Part {{index}} of {{total}}", {
                                    index: i + 1,
                                    total: job.downloadUrls!.length,
                                  })}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {job.expiresAt && (
                      <span className="text-xs text-muted-foreground">
                        {t("downloadsPage.expiresPrefix", "Expires {{time}}", {
                          time: formatExpiration(job.expiresAt),
                        })}
                      </span>
                    )}
                  </div>
                )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
