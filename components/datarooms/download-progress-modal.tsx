"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileArchive,
  Loader2,
  Plus,
  XCircle,
} from "lucide-react";

import { DownloadJob } from "@/lib/redis-download-job-store";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

export interface DownloadJobStatus {
  id: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  phase?: "VALIDATING" | "BUILDING" | "ZIPPING";
  progress: number;
  totalFiles: number;
  processedFiles: number;
  downloadUrls?: string[];
  error?: string;
  isReady: boolean;
  dataroomName: string;
  createdAt: string;
  completedAt?: string;
  expiresAt?: string;
}

function getProgressMessage(status: DownloadJobStatus | null): string {
  if (!status) return "Starting download...";
  if (status.status === "PENDING") {
    switch (status.phase) {
      case "VALIDATING":
        return "Verifying access...";
      case "BUILDING":
        return "Building file list...";
      default:
        return "Preparing your download...";
    }
  }
  if (status.status === "PROCESSING") {
    if (status.totalFiles > 0) {
      return `Processing ${status.processedFiles} of ${status.totalFiles} files...`;
    }
    return "Creating ZIP archive...";
  }
  if (status.status === "COMPLETED") {
    return status.downloadUrls && status.downloadUrls.length > 1
      ? `Your download is ready! ${status.downloadUrls.length} ZIP files have been created.`
      : "Your download is ready!";
  }
  return status.error || "Download failed. Please try again.";
}

interface DownloadProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobId: string | null;
  dataroomName?: string;
  /** Display-only. Set when the job was scoped to a single folder. */
  folderName?: string;
  // For team member downloads (uses next-auth session)
  teamId: string;
  dataroomId: string;
}

export function DownloadProgressModal({
  isOpen,
  onClose,
  jobId,
  dataroomName,
  folderName,
  teamId,
  dataroomId,
}: DownloadProgressModalProps) {
  const [status, setStatus] = useState<DownloadJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [existingDownloads, setExistingDownloads] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewDownload, setShowNewDownload] = useState(false);
  // Tracks the scope of the job currently on screen, not of the modal. A
  // failed folder job offers "Back to Downloads", from where "Start New
  // Download" always creates a whole-dataroom job, so the folder name has to
  // stop being the title at that point.
  const [scopeFolderName, setScopeFolderName] = useState(folderName);
  const [isStartingDownload, setIsStartingDownload] = useState(false);
  const [expandedDownloadId, setExpandedDownloadId] = useState<string | null>(
    null,
  );
  const [downloadProgress, setDownloadProgress] = useState<{
    downloadId: string;
    current: number;
    total: number;
  } | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup interval on component unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Fetch existing downloads when modal opens
  useEffect(() => {
    if (!isOpen || !teamId || !dataroomId) return;

    const fetchExistingDownloads = async () => {
      try {
        setLoading(true);

        const endpoint = `/api/teams/${teamId}/datarooms/${dataroomId}/download/jobs`;

        const response = await fetch(endpoint, {
          method: "GET",
          credentials: "include",
        });

        if (response.ok) {
          const downloads = await response.json();
          setExistingDownloads(downloads);
        } else {
          console.error("Failed to fetch existing downloads");
        }
      } catch (error) {
        console.error("Error fetching existing downloads:", error);
      } finally {
        // A caller that hands us a jobId already started that job, so we go
        // straight to progress. Independent of the job list loading, which
        // would otherwise strand a running job behind an empty history view.
        if (jobId) {
          setShowNewDownload(true);
        }
        setLoading(false);
      }
    };

    fetchExistingDownloads();
  }, [isOpen, dataroomId, teamId, jobId]);

  const fetchStatus = useCallback(
    async (statusJobId: string) => {
      if (!statusJobId || !teamId || !dataroomId) return;

      try {
        const url = `/api/teams/${teamId}/datarooms/${dataroomId}/download/${statusJobId}`;

        const response = await fetch(url, {
          credentials: "include",
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to fetch download status");
        }
        const data = await response.json();
        setStatus(data);
        setError(null);

        // Stop polling when job is completed or failed
        if (data.status === "COMPLETED" || data.status === "FAILED") {
          setIsPolling(false);
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
        setIsPolling(false);
      }
    },
    [teamId, dataroomId],
  );

  // Start polling when we have a jobId and showNewDownload is true
  useEffect(() => {
    if (isOpen && jobId && showNewDownload) {
      setIsPolling(true);
      setStatus(null);
      setError(null);
      fetchStatus(jobId);

      // Start polling interval
      pollIntervalRef.current = setInterval(() => fetchStatus(jobId), 2000);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isOpen, jobId, showNewDownload, fetchStatus]);

  const startNewDownload = async () => {
    if (!teamId || !dataroomId) {
      setError("Missing required parameters to start download");
      return;
    }

    setIsStartingDownload(true);
    setShowNewDownload(true);
    setScopeFolderName(undefined);

    try {
      const endpoint = `/api/teams/${teamId}/datarooms/${dataroomId}/download/bulk`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to start download");
      }

      if (data.jobId) {
        // Start polling for this job
        setStatus({
          id: data.jobId,
          status: data.status || "PENDING",
          progress: 0,
          totalFiles: 0,
          processedFiles: 0,
          isReady: false,
          dataroomName: dataroomName || "",
          createdAt: new Date().toISOString(),
        });
        setIsPolling(true);

        const statusUrl = `/api/teams/${teamId}/datarooms/${dataroomId}/download/${data.jobId}`;

        pollIntervalRef.current = setInterval(async () => {
          const statusResponse = await fetch(statusUrl, {
            credentials: "include",
          });
          if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            setStatus(statusData);

            if (
              statusData.status === "COMPLETED" ||
              statusData.status === "FAILED"
            ) {
              setIsPolling(false);
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
              }
            }
          }
        }, 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setShowNewDownload(false);
    } finally {
      setIsStartingDownload(false);
    }
  };

  const handleDownload = (url: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
    }, 100);
  };

  const handleDownloadAll = async (downloadId: string, urls: string[]) => {
    if (downloadProgress) return;
    setDownloadProgress({ downloadId, current: 0, total: urls.length });
    for (let i = 0; i < urls.length; i++) {
      setDownloadProgress({ downloadId, current: i + 1, total: urls.length });
      handleDownload(urls[i]);
      if (i < urls.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    setDownloadProgress(null);
  };

  const handleClose = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setStatus(null);
    setError(null);
    setIsPolling(false);
    setShowNewDownload(false);
    setExistingDownloads([]);
    setExpandedDownloadId(null);
    setLoading(true);
    onClose();
  };

  const getStatusIcon = (jobStatus?: string) => {
    switch (jobStatus) {
      case "PENDING":
        return (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        );
      case "PROCESSING":
        return <FileArchive className="h-4 w-4 animate-pulse text-primary" />;
      case "COMPLETED":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "FAILED":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        );
    }
  };

  const getStatusColor = (jobStatus: string) => {
    switch (jobStatus) {
      case "COMPLETED":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "PROCESSING":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "PENDING":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "FAILED":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatExpirationTime = (expiresAt?: string) => {
    if (!expiresAt) return null;

    const expires = new Date(expiresAt);
    const now = new Date();
    const diffMs = expires.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays} day${diffDays > 1 ? "s" : ""}`;
    } else if (diffHours > 0) {
      return `${diffHours} hour${diffHours > 1 ? "s" : ""}`;
    }
    return "less than an hour";
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Download{" "}
            {scopeFolderName ||
              dataroomName ||
              status?.dataroomName ||
              "Dataroom"}
          </DialogTitle>
          <DialogDescription>
            {showNewDownload
              ? status?.status === "COMPLETED"
                ? "Your files are ready to download."
                : "Please wait while we prepare your files..."
              : "View previous downloads or start a new one."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : showNewDownload ? (
          // Show download progress
          <div className="flex flex-col items-center space-y-4 py-6">
            {/* Status Icon */}
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              {status?.status === "COMPLETED" ? (
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              ) : status?.status === "FAILED" ? (
                <XCircle className="h-8 w-8 text-destructive" />
              ) : (
                <FileArchive className="h-8 w-8 animate-pulse text-primary" />
              )}
            </div>

            {/* Status Message */}
            <p
              className={cn(
                "text-center text-sm",
                status?.status === "FAILED"
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {getProgressMessage(status)}
            </p>

            {/* Progress Bar */}
            {(status?.status === "PROCESSING" ||
              status?.status === "PENDING") && (
              <div className="w-full space-y-2">
                <Progress
                  value={status?.progress || 0}
                  text={`${status?.progress || 0}%`}
                  className="h-4"
                />
                <p className="text-center text-xs text-muted-foreground">
                  {status?.totalFiles
                    ? `${status.processedFiles || 0} / ${status.totalFiles} files`
                    : "Calculating..."}
                </p>
              </div>
            )}

            {/* Download Links */}
            {status?.status === "COMPLETED" && status.downloadUrls && (
              <div className="w-full space-y-3">
                {status.downloadUrls.length === 1 ? (
                  <Button
                    className="w-full"
                    onClick={() => handleDownload(status.downloadUrls![0])}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download ZIP
                  </Button>
                ) : (
                  <>
                    <Button
                      className="w-full"
                      disabled={!!downloadProgress}
                      onClick={() =>
                        handleDownloadAll(status.id, status.downloadUrls!)
                      }
                    >
                      {downloadProgress?.downloadId === status.id ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Downloading {downloadProgress.current} of{" "}
                          {downloadProgress.total}...
                        </>
                      ) : (
                        <>
                          <Download className="mr-2 h-4 w-4" />
                          Download All ({status.downloadUrls.length} parts)
                        </>
                      )}
                    </Button>
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Or download individually:
                      </p>
                      <div className="max-h-48 space-y-1 overflow-y-auto">
                        {status.downloadUrls.map((url, index) => (
                          <Button
                            key={index}
                            variant="outline"
                            size="sm"
                            className="w-full justify-start"
                            onClick={() => handleDownload(url)}
                          >
                            <FileArchive className="mr-2 h-3 w-3" />
                            Part {index + 1} of {status.downloadUrls!.length}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Expiration Notice */}
                {status.expiresAt && (
                  <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                    <AlertCircle className="h-3 w-3" />
                    <span>
                      Download expires in{" "}
                      {formatExpirationTime(status.expiresAt)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Error State */}
            {status?.status === "FAILED" && (
              <Button
                variant="outline"
                onClick={() => setShowNewDownload(false)}
              >
                Back to Downloads
              </Button>
            )}

            {/* Back button for processing state */}
            {(status?.status === "PROCESSING" ||
              status?.status === "PENDING") && (
              <DialogFooter className="w-full sm:justify-center">
                <p className="text-xs text-muted-foreground">
                  You can close this dialog. We&apos;ll notify you when your
                  download is ready.
                </p>
              </DialogFooter>
            )}

            {/* Loading Error */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            )}
          </div>
        ) : (
          // Show existing downloads and new download option
          <div className="space-y-4 py-2">
            {existingDownloads.length > 0 ? (
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Recent Downloads</h4>
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {existingDownloads.map((download) => (
                    <div key={download.id} className="space-y-2">
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(download.status)}
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(download.status)}`}
                            >
                              {download.status}
                            </span>
                          </div>
                          <div className="text-sm font-medium">
                            {download.type === "folder"
                              ? download.folderName
                              : "Entire dataroom"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatDate(download.createdAt)}
                          </div>
                          {download.totalFiles > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {download.totalFiles} files
                              {download.downloadUrls &&
                                download.downloadUrls.length > 1 &&
                                ` (${download.downloadUrls.length} ZIPs)`}
                            </div>
                          )}
                          {download.expiresAt && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <AlertCircle className="h-3 w-3" />
                              Expires in{" "}
                              {formatExpirationTime(download.expiresAt)}
                            </div>
                          )}
                          {download.error && (
                            <p className="text-xs text-destructive">
                              {download.error}
                            </p>
                          )}
                        </div>
                        {download.status === "COMPLETED" &&
                          download.downloadUrls &&
                          download.downloadUrls.length > 0 &&
                          (download.downloadUrls.length === 1 ? (
                            <Button
                              size="sm"
                              onClick={() =>
                                handleDownload(download.downloadUrls![0])
                              }
                            >
                              <Download className="mr-1 h-3 w-3" />
                              Download
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setExpandedDownloadId(
                                  expandedDownloadId === download.id
                                    ? null
                                    : download.id,
                                )
                              }
                            >
                              {expandedDownloadId === download.id ? (
                                <>
                                  <ChevronUp className="mr-1 h-3 w-3" />
                                  Hide
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="mr-1 h-3 w-3" />
                                  Show Downloads
                                </>
                              )}
                            </Button>
                          ))}
                        {(download.status === "PENDING" ||
                          download.status === "PROCESSING") && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {download.progress}%
                          </div>
                        )}
                      </div>
                      {/* Expanded download parts */}
                      {expandedDownloadId === download.id &&
                        download.downloadUrls &&
                        download.downloadUrls.length > 1 && (
                          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                            <Button
                              size="sm"
                              className="w-full"
                              disabled={!!downloadProgress}
                              onClick={() =>
                                handleDownloadAll(
                                  download.id,
                                  download.downloadUrls!,
                                )
                              }
                            >
                              {downloadProgress?.downloadId === download.id ? (
                                <>
                                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                  Downloading {downloadProgress.current} of{" "}
                                  {downloadProgress.total}...
                                </>
                              ) : (
                                <>
                                  <Download className="mr-2 h-3 w-3" />
                                  Download All ({
                                    download.downloadUrls.length
                                  }{" "}
                                  parts)
                                </>
                              )}
                            </Button>
                            <p className="text-xs text-muted-foreground">
                              Or download individually:
                            </p>
                            <div className="max-h-32 space-y-1 overflow-y-auto">
                              {download.downloadUrls.map((url, index) => (
                                <Button
                                  key={index}
                                  variant="outline"
                                  size="sm"
                                  className="w-full justify-start"
                                  onClick={() => handleDownload(url)}
                                >
                                  <FileArchive className="mr-2 h-3 w-3" />
                                  Part {index + 1} of{" "}
                                  {download.downloadUrls!.length}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-4 text-center text-sm text-muted-foreground">
                No previous downloads found
              </div>
            )}

            <div className="border-t pt-4">
              <Button
                className="w-full"
                onClick={startNewDownload}
                disabled={isStartingDownload}
              >
                {isStartingDownload ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Start New Download
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
