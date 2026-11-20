import { nanoid } from "@/lib/utils";

import { redis } from "./redis";

export type DownloadJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

/**
 * Sub-phase within a job's lifecycle. Lets the UI show meaningful copy
 * during the "PENDING" stretch, which can be many seconds for big
 * datarooms while we re-validate the link, load folders/documents, and
 * persist analytics rows before the first Lambda call.
 *
 * - VALIDATING: re-checking link/dataroom is still permitted to download
 * - BUILDING:   loading folders/documents/permissions and building the
 *               folder tree + writing analytics rows
 * - ZIPPING:    Lambda invocations to actually produce ZIP parts
 */
export type DownloadJobPhase = "VALIDATING" | "BUILDING" | "ZIPPING";

export interface DownloadJob {
  id: string;
  type: "bulk" | "folder";
  status: DownloadJobStatus;
  /**
   * Optional finer-grained phase for the UI. Only set by the trigger
   * task; older jobs and the legacy admin path may not have it.
   */
  phase?: DownloadJobPhase;
  dataroomId: string;
  dataroomName: string;
  totalFiles: number;
  processedFiles: number;
  progress: number; // 0-100
  downloadUrls?: string[]; // Multiple ZIPs if large (S3 presigned URLs auto-expire)
  downloadS3Keys?: { bucket: string; key: string; region: string }[]; // S3 object references for on-demand presigning
  error?: string;
  teamId: string;
  userId: string;
  /** Viewer download: link this job belongs to */
  linkId?: string;
  /** Viewer download: viewer record id */
  viewerId?: string;
  /** Viewer download: email used for job list and email notification */
  viewerEmail?: string;
  triggerRunId?: string; // Trigger.dev run ID for cancellation
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  expiresAt?: string; // When download links expire
  emailNotification?: boolean;
  emailAddress?: string;
  /** Folder download: name of the folder (when type === "folder") */
  folderName?: string;
}

const JOB_PREFIX = "download_job:";
const TEAM_JOBS_PREFIX = "team_download_jobs:";
const VIEWER_JOBS_PREFIX = "viewer_download_jobs:";
const JOB_TTL = 60 * 60 * 24 * 3; // 3 days - Redis handles cleanup via TTL

export class RedisDownloadJobStore {
  private getJobKey(jobId: string): string {
    return `${JOB_PREFIX}${jobId}`;
  }

  private getTeamJobsKey(teamId: string): string {
    return `${TEAM_JOBS_PREFIX}${teamId}`;
  }

  private getViewerJobsKey(linkId: string, viewerEmail: string): string {
    return `${VIEWER_JOBS_PREFIX}${linkId}:${viewerEmail.toLowerCase()}`;
  }

  async createJob(
    jobData: Omit<DownloadJob, "id" | "createdAt" | "updatedAt">,
  ): Promise<DownloadJob> {
    const jobId = nanoid();
    const now = new Date().toISOString();

    const job: DownloadJob = {
      ...jobData,
      id: jobId,
      createdAt: now,
      updatedAt: now,
    };

    const jobKey = this.getJobKey(jobId);
    const teamJobsKey = this.getTeamJobsKey(jobData.teamId);

    // Store job data with TTL (Redis handles cleanup)
    await redis.setex(jobKey, JOB_TTL, JSON.stringify(job));

    // Add to team's job list (sorted by creation time)
    await redis.zadd(teamJobsKey, { score: Date.now(), member: jobId });
    await redis.expire(teamJobsKey, JOB_TTL);

    // If viewer download, add to viewer index for getViewerJobs
    if (jobData.linkId && jobData.viewerEmail) {
      const viewerJobsKey = this.getViewerJobsKey(
        jobData.linkId,
        jobData.viewerEmail,
      );
      await redis.zadd(viewerJobsKey, { score: Date.now(), member: jobId });
      await redis.expire(viewerJobsKey, JOB_TTL);
    }

    return job;
  }

  async getJob(jobId: string): Promise<DownloadJob | null> {
    const jobKey = this.getJobKey(jobId);
    const jobData = await redis.get(jobKey);

    if (!jobData) {
      return null;
    }

    try {
      // Check if data is already an object (Redis client auto-parsed)
      if (typeof jobData === "object") {
        return jobData as DownloadJob;
      }
      // Otherwise parse the JSON string
      return JSON.parse(jobData as string);
    } catch (error) {
      console.error("Error parsing download job data:", error);
      return null;
    }
  }

  async updateJob(
    jobId: string,
    updates: Partial<DownloadJob>,
  ): Promise<DownloadJob | null> {
    const job = await this.getJob(jobId);
    if (!job) {
      return null;
    }

    const updatedJob: DownloadJob = {
      ...job,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const jobKey = this.getJobKey(jobId);
    await redis.setex(jobKey, JOB_TTL, JSON.stringify(updatedJob));

    return updatedJob;
  }

  private async getTeamJobs(
    teamId: string,
    limit: number = 20,
  ): Promise<DownloadJob[]> {
    const teamJobsKey = this.getTeamJobsKey(teamId);

    // Get job IDs sorted by creation time (newest first)
    const jobIds = await redis.zrange(teamJobsKey, 0, limit - 1, { rev: true });

    if (!jobIds.length) {
      return [];
    }

    // Get all job data
    const jobs = await Promise.all(
      (jobIds as string[]).map((jobId: string) => this.getJob(jobId)),
    );

    // Filter out null values (expired jobs)
    return jobs.filter(
      (job: DownloadJob | null): job is DownloadJob => job !== null,
    );
  }

  async getDataroomJobs(
    dataroomId: string,
    teamId: string,
    limit: number = 10,
  ): Promise<DownloadJob[]> {
    const teamJobs = await this.getTeamJobs(teamId, limit * 2); // Get more to filter

    // Filter jobs by dataroom
    return teamJobs
      .filter((job) => {
        const matchesDataroom = job.dataroomId === dataroomId;
        const matchStatus = job.status !== "FAILED";
        return matchesDataroom && matchStatus;
      })
      .slice(0, limit);
  }

  /**
   * List download jobs for a viewer (link + email). Used on viewer downloads page.
   */
  async getViewerJobs(
    linkId: string,
    viewerEmail: string,
    limit: number = 20,
  ): Promise<DownloadJob[]> {
    const viewerJobsKey = this.getViewerJobsKey(linkId, viewerEmail);
    const jobIds = await redis.zrange(viewerJobsKey, 0, limit - 1, {
      rev: true,
    });

    if (!jobIds.length) {
      return [];
    }

    const jobs = await Promise.all(
      (jobIds as string[]).map((jobId: string) => this.getJob(jobId)),
    );

    return jobs.filter(
      (job: DownloadJob | null): job is DownloadJob => job !== null,
    );
  }
}

export const downloadJobStore = new RedisDownloadJobStore();
