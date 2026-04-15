import { logger, task } from "@trigger.dev/sdk";
import { put } from "@vercel/blob";
import Bottleneck from "bottleneck";

import { sendExportReadyEmail } from "@/lib/emails/send-export-ready-email";
import prisma from "@/lib/prisma";
import { jobStore } from "@/lib/redis-job-store";
import {
  getViewPageDuration,
  getViewUserAgent,
  getViewUserAgent_v2,
} from "@/lib/tinybird";

// Helper function to properly escape CSV fields
function escapeCsvField(field: string | number | null | undefined): string {
  if (field === null || field === undefined) {
    return "NaN";
  }

  const stringField = String(field);

  // If the field contains comma, newline, or quote, wrap in quotes and escape quotes
  if (
    stringField.includes(",") ||
    stringField.includes("\n") ||
    stringField.includes("\r") ||
    stringField.includes('"')
  ) {
    return `"${stringField.replace(/"/g, '""')}"`;
  }

  return stringField;
}

// Helper function to convert array of fields to properly escaped CSV row
function createCsvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(escapeCsvField).join(",");
}

// Create a bottleneck instance to limit tinybird API calls
const tinybirdLimiter = new Bottleneck({
  maxConcurrent: 5, // Maximum 5 concurrent requests
  minTime: 200, // Minimum 200ms between requests
});

export type ExportVisitsPayload = {
  type: "document" | "dataroom" | "dataroom-group";
  teamId: string;
  resourceId: string; // document ID or dataroom ID
  groupId?: string; // for dataroom groups
  userId: string;
  exportId: string; // unique identifier for this export job
};

export const exportVisitsTask = task({
  id: "export-visits",
  retry: { maxAttempts: 2 },
  run: async (payload: ExportVisitsPayload) => {
    const { type, teamId, resourceId, groupId, userId, exportId } = payload;

    logger.info("Starting export visits task", { payload });

    try {
      // Update job status to processing
      await jobStore.updateJob(exportId, { status: "PROCESSING" });

      // Verify team access
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: userId,
            },
          },
        },
        select: { plan: true },
      });

      if (!team) {
        throw new Error("Team not found or access denied");
      }

      if (team.plan === "free") {
        throw new Error("This feature is not available for your plan");
      }

      let csvData: string;
      let resourceName: string;

      if (type === "document") {
        ({ csvData, resourceName } = await exportDocumentVisits(
          resourceId,
          teamId,
        ));
      } else if (type === "dataroom") {
        ({ csvData, resourceName } = await exportDataroomVisits(
          resourceId,
          teamId,
          groupId,
        ));
      } else {
        throw new Error("Invalid export type");
      }

      // Create timestamp for filename
      const currentTime = new Date().toISOString().split("T")[0];

      // Upload CSV to Vercel Blob
      const filename = `visits-${resourceName.replace(/[^a-zA-Z0-9]/g, "_")}-${currentTime}.csv`;
      const blob = await put(filename, csvData, {
        access: "public",
        addRandomSuffix: true,
        contentType: "text/csv",
      });

      logger.info("CSV uploaded to Vercel Blob", {
        filename,
        url: blob.downloadUrl,
        size: csvData.length,
      });

      // Store the blob URL in Redis
      const updatedJob = await jobStore.updateJob(exportId, {
        status: "COMPLETED",
        result: blob.downloadUrl,
        resourceName,
        completedAt: new Date().toISOString(),
      });

      // Send email notification if requested
      if (updatedJob?.emailNotification && updatedJob.emailAddress) {
        try {
          await sendExportReadyEmail({
            to: updatedJob.emailAddress,
            resourceName: resourceName,
            downloadUrl: `${process.env.NEXTAUTH_URL}/api/teams/${teamId}/export-jobs/${exportId}?download=true`,
          });
          logger.info("Export ready email sent", {
            exportId,
            emailAddress: updatedJob.emailAddress,
          });
        } catch (error) {
          logger.error("Failed to send export ready email", {
            exportId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info("Export visits task completed successfully", {
        exportId,
        type,
        resourceId,
        csvSize: csvData.length,
        blobUrl: blob.downloadUrl,
      });

      return {
        success: true,
        exportId,
        resourceName,
        csvSize: csvData.length,
        blobUrl: blob.downloadUrl,
      };
    } catch (error) {
      logger.error("Export visits task failed", {
        exportId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Update job status to failed
      await jobStore.updateJob(exportId, {
        status: "FAILED",
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  },
});

// Helper function to check if a view occurred during a pause period
function isViewDuringPause(
  viewedAt: Date,
  pauseStartsAt: Date | null,
  pauseEndsAt: Date | null,
): boolean {
  if (!pauseStartsAt || !pauseEndsAt) {
    return false;
  }
  return viewedAt >= pauseStartsAt && viewedAt <= pauseEndsAt;
}

async function exportDocumentVisits(
  docId: string,
  teamId: string,
): Promise<{
  csvData: string;
  resourceName: string;
}> {
  // Fetch Document with team pause information
  const document = await prisma.document.findUnique({
    where: { id: docId, teamId: teamId },
    select: {
      id: true,
      name: true,
      numPages: true,
      versions: {
        orderBy: { createdAt: "desc" },
        select: {
          versionNumber: true,
          createdAt: true,
          numPages: true,
        },
      },
      team: {
        select: {
          plan: true,
          pauseStartsAt: true,
          pauseEndsAt: true,
        },
      },
    },
  });

  if (!document) {
    throw new Error("Document not found");
  }

  const { pauseStartsAt, pauseEndsAt } = document.team;

  // Fetch views
  const allViews = await prisma.view.findMany({
    where: { documentId: docId },
    include: {
      link: { select: { name: true } },
      agreementResponse: {
        include: {
          agreement: {
            select: {
              name: true,
              content: true,
            },
          },
        },
      },
      customFieldResponse: {
        select: {
          data: true,
        },
      },
    },
    orderBy: {
      viewedAt: "desc",
    },
  });

  // Filter out views that occurred during the pause period
  const views = allViews.filter(
    (view) => !isViewDuringPause(view.viewedAt, pauseStartsAt, pauseEndsAt),
  );

  if (!views || views.length === 0) {
    throw new Error("Document has no views");
  }

  const isProPlan = document.team.plan.includes("pro");

  // Collect all unique custom fields from all views
  const uniqueCustomFields = collectUniqueCustomFields(views);

  // Create CSV rows array starting with headers
  const csvRows: string[] = [];
  const headers = [
    "Viewed at",
    "Name",
    "Email",
    "Link Name",
    "Total View Duration (s)",
    "Total Document Completion (%)",
    "Document version",
    "Downloaded at",
    "Verified",
    "Agreement Accepted",
    "Agreement Name",
    "Agreement Content",
    "Agreement Accepted At",
    "Viewed from dataroom",
    "Browser",
    "OS",
    "Device",
  ];

  if (!isProPlan) {
    headers.push("Country", "City");
    // Add dynamic custom field headers
    headers.push(...generateCustomFieldHeaders(uniqueCustomFields));
  }

  csvRows.push(createCsvRow(headers));

  // Process views with rate limiting
  logger.info("Processing document views with rate limiting", {
    viewCount: views.length,
  });

  for (let i = 0; i < views.length; i++) {
    const view = views[i];

    logger.info(`Processing view ${i + 1}/${views.length}`, {
      viewId: view.id,
      viewedAt: view.viewedAt,
    });

    // Rate-limited calls to tinybird
    const [duration, userAgentData] = await Promise.all([
      tinybirdLimiter.schedule(() =>
        getViewPageDuration({
          documentId: docId,
          viewId: view.id,
          since: 0,
        }),
      ),
      tinybirdLimiter.schedule(async () => {
        const result = await getViewUserAgent({
          viewId: view.id,
        });

        if (!result || result.rows === 0) {
          return getViewUserAgent_v2({
            documentId: docId,
            viewId: view.id,
            since: 0,
          });
        }

        return result;
      }),
    ]);

    const relevantDocumentVersion = document.versions.find(
      (version) => version.createdAt <= view.viewedAt,
    );

    const numPages =
      relevantDocumentVersion?.numPages || document.numPages || 0;
    const completionRate = numPages
      ? (duration.data.length / numPages) * 100
      : 0;

    const totalDuration = duration.data.reduce(
      (total, data) => total + data.sum_duration,
      0,
    );

    const rowData = [
      view.viewedAt.toISOString(),
      view.viewerName || "NaN",
      view.viewerEmail || "NaN",
      view.link?.name || "NaN",
      (totalDuration / 1000.0).toFixed(1),
      completionRate.toFixed(2) + "%",
      relevantDocumentVersion?.versionNumber ||
        document.versions[0]?.versionNumber ||
        "NaN",
      view.downloadedAt ? view.downloadedAt.toISOString() : "NaN",
      view.verified ? "Yes" : "No",
      view.agreementResponse ? "Yes" : "NaN",
      view.agreementResponse?.agreement.name || "NaN",
      view.agreementResponse?.agreement.content || "NaN",
      view.agreementResponse?.createdAt.toISOString() || "NaN",
      view.dataroomId ? "Yes" : "No",
      userAgentData?.data[0]?.browser || "NaN",
      userAgentData?.data[0]?.os || "NaN",
      userAgentData?.data[0]?.device || "NaN",
    ];

    if (!isProPlan) {
      rowData.push(
        userAgentData?.data[0]?.country || "NaN",
        userAgentData?.data[0]?.city || "NaN",
      );
      // Add custom field values for this view
      rowData.push(...extractCustomFieldValues(view, uniqueCustomFields));
    }

    csvRows.push(createCsvRow(rowData));
  }

  return {
    csvData: csvRows.join("\n"),
    resourceName: document.name,
  };
}

// Helper function to extract all unique custom fields from views
function collectUniqueCustomFields(
  views: any[],
): Array<{ identifier: string; label: string }> {
  const uniqueFields = new Map<string, string>();

  views.forEach((view, index) => {
    try {
      if (
        view &&
        view.customFieldResponse?.data &&
        Array.isArray(view.customFieldResponse.data)
      ) {
        view.customFieldResponse.data.forEach((field: any) => {
          if (field.identifier && field.label) {
            uniqueFields.set(field.identifier, field.label);
          }
        });
      }
    } catch (error) {
      logger.warn(`Error processing custom fields for view ${index}:`, {
        error: String(error),
      });
    }
  });

  // Sort by identifier for consistent column ordering
  return Array.from(uniqueFields.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([identifier, label]) => ({ identifier, label }));
}

// Helper function to generate custom field headers
function generateCustomFieldHeaders(
  uniqueFields: Array<{ identifier: string; label: string }>,
): string[] {
  const headers: string[] = [];
  uniqueFields.forEach((field, index) => {
    headers.push(`Custom Field ${index + 1} Label`);
    headers.push(`Custom Field ${index + 1} Value`);
  });
  return headers;
}

// Helper function to extract custom field values for a specific view
function extractCustomFieldValues(
  view: any,
  uniqueFields: Array<{ identifier: string; label: string }>,
): string[] {
  const values: string[] = [];

  try {
    // Create a map of the current view's custom field responses
    const responseMap = new Map<string, { label: string; response: string }>();

    // Check if view exists and has customFieldResponse
    if (
      view &&
      view.customFieldResponse?.data &&
      Array.isArray(view.customFieldResponse.data)
    ) {
      view.customFieldResponse.data.forEach((field: any) => {
        if (field && field.identifier) {
          responseMap.set(field.identifier, {
            label: field.label || "NaN",
            response: field.response || "NaN",
          });
        }
      });
    }

    // Fill in values for each unique field in order
    uniqueFields.forEach((field) => {
      const response = responseMap.get(field.identifier);
      if (response) {
        values.push(response.label);
        values.push(response.response);
      } else {
        values.push("NaN");
        values.push("NaN");
      }
    });
  } catch (error) {
    logger.warn(`Error extracting custom field values:`, {
      error: String(error),
    });
    // Fill with NaN values if there's an error
    uniqueFields.forEach(() => {
      values.push("NaN");
      values.push("NaN");
    });
  }

  return values;
}

async function exportDataroomVisits(
  dataroomId: string,
  teamId: string,
  groupId?: string,
): Promise<{
  csvData: string;
  resourceName: string;
}> {
  // Fetch Dataroom with team pause information
  const dataroom = await prisma.dataroom.findUnique({
    where: { id: dataroomId, teamId: teamId },
    select: {
      id: true,
      name: true,
      documents: {
        select: {
          id: true,
          document: {
            select: {
              name: true,
              numPages: true,
              versions: {
                orderBy: { createdAt: "desc" },
                select: {
                  versionNumber: true,
                  createdAt: true,
                  numPages: true,
                },
              },
            },
          },
        },
      },
      team: {
        select: {
          pauseStartsAt: true,
          pauseEndsAt: true,
        },
      },
    },
  });

  if (!dataroom) {
    throw new Error("Dataroom not found");
  }

  const { pauseStartsAt, pauseEndsAt } = dataroom.team;

  // Fetch views
  const allViews = await prisma.view.findMany({
    where: {
      dataroomId: dataroomId,
      ...(groupId && { groupId }),
    },
    include: {
      link: { select: { name: true } },
      agreementResponse: {
        include: {
          agreement: {
            select: {
              name: true,
              content: true,
            },
          },
        },
      },
      document: {
        select: {
          id: true,
          name: true,
          numPages: true,
          versions: {
            orderBy: { createdAt: "desc" },
            select: {
              versionNumber: true,
              createdAt: true,
              numPages: true,
            },
          },
        },
      },
      customFieldResponse: {
        select: {
          data: true,
        },
      },
    },
    orderBy: {
      viewedAt: "desc",
    },
  });

  // Filter out views that occurred during the pause period
  const views = allViews.filter(
    (view) => !isViewDuringPause(view.viewedAt, pauseStartsAt, pauseEndsAt),
  );

  if (!views || views.length === 0) {
    throw new Error("Dataroom has no views");
  }

  // First get all dataroom views
  const dataroomViews = views.filter(
    (view) => view.viewType === "DATAROOM_VIEW",
  );
  const documentViews = views.filter(
    (view) => view.viewType === "DOCUMENT_VIEW",
  );

  // Collect all unique custom fields from dataroom views
  const uniqueCustomFields = collectUniqueCustomFields(dataroomViews);

  logger.info("Processing dataroom views with rate limiting", {
    dataroomViewCount: dataroomViews.length,
    documentViewCount: documentViews.length,
  });

  // Process dataroom views
  const exportData = [];
  for (let i = 0; i < dataroomViews.length; i++) {
    const dataroomView = dataroomViews[i];

    logger.info(`Processing dataroom view ${i + 1}/${dataroomViews.length}`, {
      viewId: dataroomView.id,
    });

    // Find associated document views
    const associatedDocViews = documentViews.filter(
      (docView) => docView.dataroomViewId === dataroomView.id,
    );

    // Process document views with rate limiting
    const documentViewDetails = [];
    for (let j = 0; j < associatedDocViews.length; j++) {
      const docView = associatedDocViews[j];

      logger.info(
        `Processing document view ${j + 1}/${associatedDocViews.length} for dataroom view ${i + 1}`,
        {
          docViewId: docView.id,
        },
      );

      const duration = await tinybirdLimiter.schedule(() =>
        getViewPageDuration({
          documentId: docView.document?.id || "null",
          viewId: docView.id,
          since: 0,
        }),
      );

      const relevantVersion = docView.document?.versions.find(
        (version) => version.createdAt <= docView.viewedAt,
      );

      const numPages =
        relevantVersion?.numPages || docView.document?.numPages || 0;
      const completionRate = numPages
        ? (duration.data.length / numPages) * 100
        : 0;

      documentViewDetails.push({
        documentName: docView.document?.name || "NaN",
        viewedAt: docView.viewedAt.toISOString(),
        downloadedAt: docView.downloadedAt?.toISOString() || "NaN",
        duration: duration.data.reduce(
          (total, data) => total + data.sum_duration,
          0,
        ),
        completionRate: completionRate.toFixed(2) + "%",
        documentVersion:
          relevantVersion?.versionNumber ||
          docView.document?.versions[0]?.versionNumber ||
          "NaN",
        viewId: docView.id,
      });
    }

    exportData.push({
      dataroomViewId: dataroomView.id, // Add the unique view ID for direct matching
      dataroomViewedAt: dataroomView.viewedAt.toISOString(),
      dataroomDownloadedAt: dataroomView.downloadedAt?.toISOString() || "NaN",
      viewerName: dataroomView.viewerName || "NaN",
      viewerEmail: dataroomView.viewerEmail || "NaN",
      linkName: dataroomView.link?.name || "NaN",
      verified: dataroomView.verified ? "Yes" : "NaN",
      agreementStatus: dataroomView.agreementResponse ? "Yes" : "NaN",
      agreementName: dataroomView.agreementResponse?.agreement.name || "NaN",
      agreementAcceptedAt:
        dataroomView.agreementResponse?.createdAt.toISOString() || "NaN",
      agreementContent:
        dataroomView.agreementResponse?.agreement.content || "NaN",
      documentViews: documentViewDetails,
    });
  }

  // Create a map for efficient dataroom view lookups by ID
  const dataroomViewMap = new Map();
  dataroomViews.forEach((view) => {
    dataroomViewMap.set(view.id, view);
  });

  // Get user agent data for all document views at once with rate limiting
  const userAgentDataMap = new Map();
  for (const docView of documentViews) {
    const userAgentData = await tinybirdLimiter.schedule(async () => {
      const result = await getViewUserAgent({
        viewId: docView.id,
      });

      if (!result || result.rows === 0) {
        return getViewUserAgent_v2({
          documentId: docView.document?.id || "null",
          viewId: docView.id,
          since: 0,
        });
      }

      return result;
    });

    userAgentDataMap.set(docView.id, userAgentData);
  }

  // Create CSV
  const csvRows: string[] = [];
  const headers = [
    "Dataroom Viewed At",
    "Dataroom Downloaded At",
    "Visitor Name",
    "Visitor Email",
    "Link Name",
    "Verified",
    "Agreement Accepted",
    "Agreement Name",
    "Agreement Content",
    "Agreement Accepted At",
    "Document Name",
    "Document Viewed At",
    "Document Downloaded At",
    "Total Visit Duration (s)",
    "Total Document Completion (%)",
    "Document Version",
    "Browser",
    "OS",
    "Device",
    "Country",
    "City",
  ];

  // Add dynamic custom field headers
  headers.push(...generateCustomFieldHeaders(uniqueCustomFields));

  csvRows.push(createCsvRow(headers));

  exportData.forEach((view) => {
    if (view.documentViews.length === 0) {
      const rowData = [
        view.dataroomViewedAt,
        view.dataroomDownloadedAt,
        view.viewerName,
        view.viewerEmail,
        view.linkName,
        view.verified,
        view.agreementStatus,
        view.agreementName,
        view.agreementContent,
        view.agreementAcceptedAt,
        "NaN",
        "NaN",
        "NaN",
        "NaN",
        "NaN",
        "NaN",
        "NaN",
        "NaN",
        "NaN",
        "NaN",
        "NaN",
      ];

      // Add custom field values for this dataroom view using direct ID lookup
      const dataroomView = dataroomViewMap.get(view.dataroomViewId);
      rowData.push(
        ...extractCustomFieldValues(dataroomView, uniqueCustomFields),
      );

      csvRows.push(createCsvRow(rowData));
    } else {
      view.documentViews.forEach((docView) => {
        const userAgentData = userAgentDataMap.get(docView.viewId);

        const rowData = [
          view.dataroomViewedAt,
          view.dataroomDownloadedAt,
          view.viewerName,
          view.viewerEmail,
          view.linkName,
          view.verified,
          view.agreementStatus,
          view.agreementName,
          view.agreementContent,
          view.agreementAcceptedAt,
          docView.documentName,
          docView.viewedAt,
          docView.downloadedAt,
          (docView.duration / 1000).toFixed(1),
          docView.completionRate,
          docView.documentVersion,
          userAgentData?.data[0]?.browser || "NaN",
          userAgentData?.data[0]?.os || "NaN",
          userAgentData?.data[0]?.device || "NaN",
          userAgentData?.data[0]?.country || "NaN",
          userAgentData?.data[0]?.city || "NaN",
        ];

        // Add custom field values for this dataroom view using direct ID lookup
        const dataroomView = dataroomViewMap.get(view.dataroomViewId);
        rowData.push(
          ...extractCustomFieldValues(dataroomView, uniqueCustomFields),
        );

        csvRows.push(createCsvRow(rowData));
      });
    }
  });

  return {
    csvData: csvRows.join("\n"),
    resourceName: dataroom.name,
  };
}
