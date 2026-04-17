import { vertex } from "@/ee/features/ai/lib/models/google";
import { openai } from "@/ee/features/ai/lib/models/openai";
import { logger, metadata, task } from "@trigger.dev/sdk";
import { generateText } from "ai";
import path from "path";

import { getFile } from "@/lib/files/get-file";
import { putFileServer } from "@/lib/files/put-file-server";
import prisma from "@/lib/prisma";
import { processImageForAIQueue } from "@/lib/trigger/queues";

import type { ProcessFilePayload } from "./types";

const IMAGE_ANALYSIS_PROMPT = `Analyze this image thoroughly and provide a detailed description for document search purposes.

Include the following in your analysis:
1. **Type of Image**: What kind of image is this? (e.g., diagram, chart, photo, screenshot, infographic, flowchart, etc.)
2. **Main Content**: What is the primary subject or content of the image?
3. **Text Content**: Extract and transcribe any visible text, labels, titles, or captions.
4. **Data & Numbers**: If there are charts, graphs, or tables, describe the data being presented.
5. **Key Details**: Note any important visual elements, colors, symbols, or indicators that convey meaning.
6. **Context**: What is the likely purpose or context of this image? What document or presentation might it belong to?

Format your response as clear, searchable text that would help someone find this image when searching for related topics.`;

/**
 * Process an image file for AI indexing
 * Uses Google Vertex AI (Gemini Flash) to analyze the image and generate a description
 */
export const processImageForAITask = task({
  id: "process-image-for-ai",
  retry: { maxAttempts: 3 },
  queue: processImageForAIQueue,
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
      contentType,
    } = payload;

    logger.info("Processing image for AI", {
      documentId,
      documentVersionId,
      teamId,
      contentType,
    });

    // Check if fileId already exists
    const version = await prisma.documentVersion.findUnique({
      where: { id: documentVersionId },
      select: { fileId: true },
    });

    if (version?.fileId) {
      logger.info("Image already processed, reusing fileId", {
        documentId,
        fileId: version.fileId,
      });
      return { fileId: version.fileId };
    }

    metadata.set("status", "retrieving");
    metadata.set("step", "Retrieving image...");
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
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());

    metadata.set("status", "processing");
    metadata.set("step", "Analyzing image with AI...");
    metadata.set("progress", 30);

    // Use Gemini Flash to analyze the image
    const { text: imageDescription } = await generateText({
      model: vertex("gemini-3-flash-preview"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: imageBuffer,
            },
            {
              type: "text",
              text: IMAGE_ANALYSIS_PROMPT,
            },
          ],
        },
      ],
    });

    metadata.set("step", "Saving processed content...");
    metadata.set("progress", 50);

    // Create markdown content with image analysis
    const fullMarkdown = `# ${documentName}

## Image Analysis

${imageDescription}

---
*This content was automatically generated from image analysis.*
`;

    // Save markdown to S3 alongside original file
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

    logger.info("Image processed successfully", {
      documentId,
      fileId: fileResponse.id,
      markdownPath,
    });

    return { fileId: fileResponse.id, markdownPath };
  },
});
