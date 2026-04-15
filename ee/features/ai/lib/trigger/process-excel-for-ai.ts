import { openai } from "@/ee/features/ai/lib/models/openai";
import { logger, metadata, task } from "@trigger.dev/sdk";
import path from "path";
import * as XLSX from "xlsx";

import { getFile } from "@/lib/files/get-file";
import { putFileServer } from "@/lib/files/put-file-server";
import prisma from "@/lib/prisma";
import { processExcelForAIQueue } from "@/lib/trigger/queues";

import type { ProcessFilePayload } from "./types";

/**
 * Convert Excel workbook to Markdown format
 */
function excelToMarkdown(workbook: XLSX.WorkBook): string {
  const markdown: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    // Add sheet header
    markdown.push(`## ${sheetName}\n`);

    // Convert sheet to array of arrays
    const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
    });

    if (data.length === 0) {
      markdown.push("*Empty sheet*\n");
      continue;
    }

    // Get headers (first row)
    const headers = data[0] as string[];
    if (!headers || headers.length === 0) continue;

    // Create markdown table header
    markdown.push(
      "| " + headers.map((h) => String(h || "")).join(" | ") + " |",
    );
    markdown.push("| " + headers.map(() => "---").join(" | ") + " |");

    // Add data rows
    for (let i = 1; i < data.length; i++) {
      const row = data[i] as unknown[];
      if (!row) continue;

      const cells = headers.map((_, idx) => {
        const cell = row[idx];
        // Handle different cell types
        if (cell === null || cell === undefined) return "";
        if (typeof cell === "object") return JSON.stringify(cell);
        return String(cell);
      });

      markdown.push("| " + cells.join(" | ") + " |");
    }

    markdown.push(""); // Empty line between sheets
  }

  return markdown.join("\n");
}

/**
 * Process an Excel file for AI indexing
 * Converts Excel to Markdown, saves to S3, then uploads to OpenAI
 */
export const processExcelForAITask = task({
  id: "process-excel-for-ai",
  retry: { maxAttempts: 3 },
  queue: processExcelForAIQueue,
  run: async (
    payload: ProcessFilePayload,
  ): Promise<{ fileId: string; markdownPath?: string }> => {
    const {
      documentId,
      documentVersionId,
      teamId,
      documentName,
      filePath,
      storageType,
    } = payload;

    logger.info("Processing Excel for AI", {
      documentId,
      documentVersionId,
      teamId,
    });

    // Check if fileId already exists
    const version = await prisma.documentVersion.findUnique({
      where: { id: documentVersionId },
      select: { fileId: true },
    });

    if (version?.fileId) {
      logger.info("Excel already processed, reusing fileId", {
        documentId,
        fileId: version.fileId,
      });
      return { fileId: version.fileId };
    }

    metadata.set("status", "retrieving");
    metadata.set("step", "Retrieving Excel file...");
    metadata.set("progress", 10);

    // Get file URL
    const fileUrl = await getFile({
      type: storageType,
      data: filePath,
      isDownload: true,
    });

    // Fetch file
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch Excel file: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    metadata.set("status", "processing");
    metadata.set("step", "Converting Excel to Markdown...");
    metadata.set("progress", 30);

    // Parse Excel file
    const workbook = XLSX.read(buffer, { type: "buffer" });

    // Convert to markdown
    const markdown = excelToMarkdown(workbook);

    // Add document metadata to markdown
    const fullMarkdown = `# ${documentName}\n\n${markdown}`;

    metadata.set("step", "Saving processed content...");
    metadata.set("progress", 50);

    // Save markdown to S3 alongside original file
    // Derive markdown path from original file path
    const markdownPath = filePath.replace(/\.[^.]+$/, ".ai.md");
    const markdownBuffer = Buffer.from(fullMarkdown, "utf-8");

    // Extract docId from file path
    const match = filePath.match(/(doc_[^\/]+)\//);
    const docId = match ? match[1] : undefined;

    // Save markdown file to S3
    await putFileServer({
      file: {
        name: path.basename(markdownPath),
        type: "text/markdown",
        buffer: markdownBuffer,
      },
      teamId,
      docId,
      restricted: false,
    });

    metadata.set("status", "uploading");
    metadata.set("step", "Uploading to OpenAI...");
    metadata.set("progress", 70);

    // Upload markdown to OpenAI Files
    const file = new File([markdownBuffer], `${documentName}.md`, {
      type: "text/markdown",
    });
    const fileResponse = await openai.files.create({
      file,
      purpose: "assistants",
    });

    // Update document version with fileId
    await prisma.documentVersion.update({
      where: { id: documentVersionId },
      data: { fileId: fileResponse.id },
    });

    logger.info("Excel processed successfully", {
      documentId,
      fileId: fileResponse.id,
      markdownPath,
    });

    return { fileId: fileResponse.id, markdownPath };
  },
});
