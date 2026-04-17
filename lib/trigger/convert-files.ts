import { python } from "@trigger.dev/python";
import { logger, retry, task } from "@trigger.dev/sdk";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getFile } from "@/lib/files/get-file";
import { putFileServer } from "@/lib/files/put-file-server";
import prisma from "@/lib/prisma";

import { updateStatus } from "../utils/generate-trigger-status";
import { getExtensionFromContentType } from "../utils/get-content-type";
import { convertPdfToImageRoute } from "./pdf-to-image-route";
import {
  convertCadToPdfQueue,
  convertFilesToPdfQueue,
  convertKeynoteToPdfQueue,
} from "./queues";

export type ConvertPayload = {
  documentId: string;
  documentVersionId: string;
  teamId: string;
};

export const convertFilesToPdfTask = task({
  id: "convert-files-to-pdf",
  retry: { maxAttempts: 3 },
  queue: convertFilesToPdfQueue,
  run: async (payload: ConvertPayload) => {
    updateStatus({ progress: 0, text: "Initializing..." });

    const team = await prisma.team.findUnique({
      where: {
        id: payload.teamId,
      },
    });

    if (!team) {
      logger.error("Team not found", { teamId: payload.teamId });
      return;
    }

    const document = await prisma.document.findUnique({
      where: {
        id: payload.documentId,
        teamId: payload.teamId,
      },
      select: {
        name: true,
        versions: {
          where: {
            id: payload.documentVersionId,
          },
          select: {
            file: true,
            originalFile: true,
            contentType: true,
            storageType: true,
          },
        },
      },
    });

    if (
      !document ||
      !document.versions[0] ||
      !document.versions[0].originalFile ||
      !document.versions[0].contentType
    ) {
      updateStatus({ progress: 0, text: "Document not found" });

      logger.error("Document not found", {
        documentId: payload.documentId,
        documentVersionId: payload.documentVersionId,
        teamId: payload.teamId,
      });
      return;
    }

    updateStatus({ progress: 10, text: "Retrieving file..." });

    const fileUrl = await getFile({
      data: document.versions[0].originalFile,
      type: document.versions[0].storageType,
    });

    const CONVERSION_TIMEOUT_MS = 3 * 60 * 1000; // 3 min client-side timeout

    updateStatus({ progress: 20, text: "Converting document…" });

    let conversionResponse: Response;
    try {
      const fd = new FormData();
      fd.append("downloadFrom", JSON.stringify([{ url: fileUrl }]));
      fd.append("quality", "75");

      conversionResponse = await fetch(
        `${process.env.NEXT_PRIVATE_CONVERSION_BASE_URL}/forms/libreoffice/convert`,
        {
          method: "POST",
          body: fd,
          headers: {
            Authorization: `Basic ${process.env.NEXT_PRIVATE_INTERNAL_AUTH_TOKEN}`,
          },
          signal: AbortSignal.timeout(CONVERSION_TIMEOUT_MS),
        },
      );
    } catch (err) {
      logger.warn("Gotenberg conversion failed, will attempt sanitization", {
        error: String(err),
      });
      conversionResponse = new Response(null, {
        status: 504,
        statusText: "Conversion timed out or unreachable",
      });
    }

    let conversionBuffer!: Buffer;

    if (!conversionResponse.ok) {
      const contentType = document.versions[0].contentType;
      const isDocx =
        contentType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

      if (isDocx) {
        const inputPath = join(tmpdir(), `input-${Date.now()}.docx`);
        const outputPath = join(tmpdir(), `output-${Date.now()}.docx`);
        try {
          let docxResponse: Response;
          try {
            docxResponse = await fetch(fileUrl);
          } catch (err) {
            updateStatus({ progress: 0, text: "Failed to retrieve DOCX file" });
            throw new Error(
              `Failed to fetch DOCX from signed URL for sanitization: ${String(err)}`,
            );
          }

          if (!docxResponse.ok) {
            updateStatus({ progress: 0, text: "Failed to retrieve DOCX file" });
            throw new Error(
              `Failed to fetch DOCX from signed URL for sanitization: HTTP ${docxResponse.status} ${docxResponse.statusText}`,
            );
          }

          const responseContentType = docxResponse.headers.get("content-type");
          if (
            responseContentType &&
            !responseContentType.includes(
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ) &&
            !responseContentType.includes("application/octet-stream")
          ) {
            updateStatus({ progress: 0, text: "Invalid DOCX download response" });
            throw new Error(
              `Signed URL returned unexpected content-type for DOCX sanitization: ${responseContentType}`,
            );
          }

          const docxBuffer = Buffer.from(await docxResponse.arrayBuffer());
          await writeFile(inputPath, docxBuffer);

          const attemptConversion = async (
            sanitizedPath: string,
          ): Promise<Response> => {
            const buf = await readFile(sanitizedPath);
            const fd = new FormData();
            fd.append(
              "files",
              new Blob([new Uint8Array(buf)], { type: contentType }),
              document.name,
            );
            fd.append("quality", "75");
            return fetch(
              `${process.env.NEXT_PRIVATE_CONVERSION_BASE_URL}/forms/libreoffice/convert`,
              {
                method: "POST",
                body: fd,
                headers: {
                  Authorization: `Basic ${process.env.NEXT_PRIVATE_INTERNAL_AUTH_TOKEN}`,
                },
                signal: AbortSignal.timeout(CONVERSION_TIMEOUT_MS),
              },
            );
          };

          logger.warn("DOCX conversion failed, sanitizing document…", {
            status: conversionResponse.status,
          });

          updateStatus({ progress: 25, text: "Sanitizing document…" });

          const result = await python.runScript(
            "./ee/features/conversions/python/docx-sanitizer.py",
            ["-v", "--mode", "all", inputPath, outputPath],
          );
          logger.info("Sanitizer output", { stderr: result.stderr });

          let retryResponse: Response;
          try {
            retryResponse = await attemptConversion(outputPath);
          } catch (err) {
            updateStatus({ progress: 0, text: "Conversion timed out" });
            throw new Error(
              `Conversion timed out after sanitization — LibreOffice could not process this file within ${CONVERSION_TIMEOUT_MS / 1000}s`,
            );
          }

          if (!retryResponse.ok) {
            updateStatus({ progress: 0, text: "Conversion failed" });
            let message: string;
            try {
              const body = await retryResponse.json();
              message = body.message ?? retryResponse.statusText;
            } catch {
              message = retryResponse.statusText || "Unknown error";
            }
            throw new Error(
              `Conversion failed after sanitization: ${message} (${retryResponse.status})`,
            );
          }

          conversionBuffer = Buffer.from(await retryResponse.arrayBuffer());
        } finally {
          await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
        }
      } else {
        updateStatus({ progress: 0, text: "Conversion failed" });
        let message: string;
        try {
          const body = await conversionResponse.json();
          message = body.message ?? conversionResponse.statusText;
        } catch {
          message = conversionResponse.statusText || "Unknown error";
        }
        throw new Error(
          `Conversion failed: ${message} (${conversionResponse.status})`,
        );
      }
    } else {
      conversionBuffer = Buffer.from(await conversionResponse.arrayBuffer());
    }

    console.log("conversionBuffer", conversionBuffer);

    // get docId from url with starts with "doc_" with regex
    const match = document.versions[0].originalFile.match(/(doc_[^\/]+)\//);
    const docId = match ? match[1] : undefined;

    updateStatus({ progress: 30, text: "Saving converted file..." });

    // Save the converted file to the database
    const { type: storageType, data } = await putFileServer({
      file: {
        name: `${document.name}.pdf`,
        type: "application/pdf",
        buffer: conversionBuffer,
      },
      teamId: payload.teamId,
      docId: docId,
    });

    if (!data || !storageType) {
      updateStatus({ progress: 0, text: "Failed to save converted file" });

      logger.error("Failed to save converted file to database", {
        documentId: payload.documentId,
        documentVersionId: payload.documentVersionId,
        teamId: payload.teamId,
        docId: docId,
      });
      return;
    }

    console.log("data from conversion", data);
    console.log("storageType from conversion", storageType);

    const { versionNumber } = await prisma.documentVersion.update({
      where: { id: payload.documentVersionId },
      data: {
        file: data,
        type: "pdf",
        storageType: storageType,
      },
      select: {
        versionNumber: true,
      },
    });

    updateStatus({ progress: 40, text: "Initiating document processing..." });

    await convertPdfToImageRoute.trigger(
      {
        documentId: payload.documentId,
        documentVersionId: payload.documentVersionId,
        teamId: payload.teamId,
        versionNumber: versionNumber,
      },
      {
        idempotencyKey: `${payload.teamId}-${payload.documentVersionId}`,
        tags: [
          `team_${payload.teamId}`,
          `document_${payload.documentId}`,
          `version:${payload.documentVersionId}`,
        ],
      },
    );

    logger.info("Document converted", {
      documentId: payload.documentId,
      documentVersionId: payload.documentVersionId,
      teamId: payload.teamId,
      docId: docId,
    });
    return;
  },
});

// convert cad file to pdf
export const convertCadToPdfTask = task({
  id: "convert-cad-to-pdf",
  retry: { maxAttempts: 3 },
  queue: convertCadToPdfQueue,
  run: async (payload: ConvertPayload) => {
    const team = await prisma.team.findUnique({
      where: {
        id: payload.teamId,
      },
    });

    if (!team) {
      logger.error("Team not found", { teamId: payload.teamId });
      return;
    }

    const document = await prisma.document.findUnique({
      where: {
        id: payload.documentId,
        teamId: payload.teamId,
      },
      select: {
        name: true,
        versions: {
          where: {
            id: payload.documentVersionId,
          },
          select: {
            file: true,
            originalFile: true,
            contentType: true,
            storageType: true,
          },
        },
      },
    });

    if (
      !document ||
      !document.versions[0] ||
      !document.versions[0].originalFile ||
      !document.versions[0].contentType
    ) {
      logger.error("Document not found", {
        documentId: payload.documentId,
        documentVersionId: payload.documentVersionId,
        teamId: payload.teamId,
      });
      return;
    }

    const fileUrl = await getFile({
      data: document.versions[0].originalFile,
      type: document.versions[0].storageType,
    });

    // create payload for cad to pdf conversion
    const tasksPayload = {
      tasks: {
        "import-file-v1": {
          operation: "import/url",
          url: fileUrl,
          filename: document.name,
        },
        "convert-file-v1": {
          operation: "convert",
          input: ["import-file-v1"],
          input_format: getExtensionFromContentType(
            document.versions[0].contentType,
          ),
          output_format: "pdf",
          engine: "cadconverter",
          all_layouts: true,
          auto_zoom: false,
        },
        "export-file-v1": {
          operation: "export/url",
          input: ["convert-file-v1"],
          inline: false,
          archive_multiple_files: false,
        },
      },
      redirect: true,
    };

    // Make the conversion request
    const conversionResponse = await retry.fetch(
      `${process.env.NEXT_PRIVATE_CONVERT_API_URL}`,
      {
        method: "POST",
        body: JSON.stringify(tasksPayload),
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PRIVATE_CONVERT_API_KEY}`,
          "Content-Type": "application/json",
        },
        retry: {
          byStatus: {
            "500-599": {
              strategy: "backoff",
              maxAttempts: 3,
              factor: 2,
              minTimeoutInMs: 1_000,
              maxTimeoutInMs: 30_000,
              randomize: false,
            },
          },
        },
      },
    );

    if (!conversionResponse.ok) {
      const body = await conversionResponse.json();
      throw new Error(
        `Conversion failed: ${body.message} ${conversionResponse.status}`,
      );
    }

    const conversionBuffer = Buffer.from(
      await conversionResponse.arrayBuffer(),
    );

    // get docId from url with starts with "doc_" with regex
    const match = document.versions[0].originalFile.match(/(doc_[^\/]+)\//);
    const docId = match ? match[1] : undefined;

    // Save the converted file to the database
    const { type: storageType, data } = await putFileServer({
      file: {
        name: `${document.name}.pdf`,
        type: "application/pdf",
        buffer: conversionBuffer,
      },
      teamId: payload.teamId,
      docId: docId,
    });

    if (!data || !storageType) {
      logger.error("Failed to save converted file to database", {
        documentId: payload.documentId,
        documentVersionId: payload.documentVersionId,
        teamId: payload.teamId,
        docId: docId,
      });
      return;
    }

    console.log("data from conversion", data);
    console.log("storageType from conversion", storageType);

    await prisma.documentVersion.update({
      where: { id: payload.documentVersionId },
      data: {
        file: data,
        type: "pdf",
        storageType: storageType,
      },
    });

    await convertPdfToImageRoute.trigger(
      {
        documentId: payload.documentId,
        documentVersionId: payload.documentVersionId,
        teamId: payload.teamId,
      },
      {
        idempotencyKey: `${payload.teamId}-${payload.documentVersionId}`,
        tags: [
          `team_${payload.teamId}`,
          `document_${payload.documentId}`,
          `version:${payload.documentVersionId}`,
        ],
      },
    );

    logger.info("Document converted", {
      documentId: payload.documentId,
      documentVersionId: payload.documentVersionId,
      teamId: payload.teamId,
      docId: docId,
    });
    return;
  },
});

// convert keynote file to pdf
export const convertKeynoteToPdfTask = task({
  id: "convert-keynote-to-pdf",
  retry: { maxAttempts: 3 },
  queue: convertKeynoteToPdfQueue,
  run: async (payload: ConvertPayload) => {
    const team = await prisma.team.findUnique({
      where: {
        id: payload.teamId,
      },
    });

    if (!team) {
      logger.error("Team not found", { teamId: payload.teamId });
      return;
    }

    const document = await prisma.document.findUnique({
      where: {
        id: payload.documentId,
        teamId: payload.teamId,
      },
      select: {
        name: true,
        versions: {
          where: {
            id: payload.documentVersionId,
          },
          select: {
            file: true,
            originalFile: true,
            contentType: true,
            storageType: true,
          },
        },
      },
    });

    if (
      !document ||
      !document.versions[0] ||
      !document.versions[0].originalFile ||
      !document.versions[0].contentType
    ) {
      logger.error("Document not found", {
        documentId: payload.documentId,
        documentVersionId: payload.documentVersionId,
        teamId: payload.teamId,
      });
      return;
    }

    const fileUrl = await getFile({
      data: document.versions[0].originalFile,
      type: document.versions[0].storageType,
    });

    // create payload for keynote to pdf conversion
    const tasksPayload = {
      tasks: {
        "import-file-v1": {
          operation: "import/url",
          url: fileUrl,
          filename: document.name,
        },
        "convert-file-v1": {
          operation: "convert",
          input: ["import-file-v1"],
          input_format: getExtensionFromContentType(
            document.versions[0].contentType,
          ),
          output_format: "pdf",
          engine: "iwork",
        },
        "export-file-v1": {
          operation: "export/url",
          input: ["convert-file-v1"],
          inline: false,
          archive_multiple_files: false,
        },
      },
      redirect: true,
    };

    // Make the conversion request
    const conversionResponse = await retry.fetch(
      `${process.env.NEXT_PRIVATE_CONVERT_API_URL}`,
      {
        method: "POST",
        body: JSON.stringify(tasksPayload),
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PRIVATE_CONVERT_API_KEY}`,
          "Content-Type": "application/json",
        },
        retry: {
          byStatus: {
            "500-599": {
              strategy: "backoff",
              maxAttempts: 3,
              factor: 2,
              minTimeoutInMs: 1_000,
              maxTimeoutInMs: 30_000,
              randomize: false,
            },
          },
        },
      },
    );

    if (!conversionResponse.ok) {
      const body = await conversionResponse.json();
      throw new Error(
        `Conversion failed: ${body.message} ${conversionResponse.status}`,
      );
    }

    const conversionBuffer = Buffer.from(
      await conversionResponse.arrayBuffer(),
    );

    // get docId from url with starts with "doc_" with regex
    const match = document.versions[0].originalFile.match(/(doc_[^\/]+)\//);
    const docId = match ? match[1] : undefined;

    // Save the converted file to the database
    const { type: storageType, data } = await putFileServer({
      file: {
        name: `${document.name}.pdf`,
        type: "application/pdf",
        buffer: conversionBuffer,
      },
      teamId: payload.teamId,
      docId: docId,
    });

    if (!data || !storageType) {
      logger.error("Failed to save converted file to database", {
        documentId: payload.documentId,
        documentVersionId: payload.documentVersionId,
        teamId: payload.teamId,
        docId: docId,
      });
      return;
    }

    console.log("data from conversion", data);
    console.log("storageType from conversion", storageType);

    await prisma.documentVersion.update({
      where: { id: payload.documentVersionId },
      data: {
        file: data,
        type: "pdf",
        storageType: storageType,
      },
    });

    await convertPdfToImageRoute.trigger(
      {
        documentId: payload.documentId,
        documentVersionId: payload.documentVersionId,
        teamId: payload.teamId,
      },
      {
        idempotencyKey: `${payload.teamId}-${payload.documentVersionId}`,
        tags: [
          `team_${payload.teamId}`,
          `document_${payload.documentId}`,
          `version:${payload.documentVersionId}`,
        ],
      },
    );

    logger.info("Keynote document converted", {
      documentId: payload.documentId,
      documentVersionId: payload.documentVersionId,
      teamId: payload.teamId,
      docId: docId,
    });
    return;
  },
});
