import { NextApiRequest, NextApiResponse } from "next";

import { getTeamStorageConfigById } from "@/ee/features/storage/config";
import { InvocationType, InvokeCommand } from "@aws-sdk/client-lambda";

import { getLambdaClientForTeam } from "@/lib/files/aws-client";

// Internal API endpoint for processing download batches
// Called by Trigger.dev task - authenticated via shared secret
export const config = {
  maxDuration: 300, // 5 minutes for Lambda invocation
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // Extract the API Key from the Authorization header
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1]; // Assuming the format is "Bearer [token]"

  // Check if the API Key matches
  if (token !== process.env.INTERNAL_API_KEY) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const {
      teamId,
      sourceBucket,
      fileKeys,
      folderStructure,
      watermarkConfig,
      zipPartNumber,
      totalParts,
      dataroomName,
      zipFileName,
      expirationHours,
    } = req.body;

    if (!teamId || !sourceBucket || !fileKeys || !folderStructure) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Get Lambda client and storage config using team credentials
    const [client, storageConfig] = await Promise.all([
      getLambdaClientForTeam(teamId),
      getTeamStorageConfigById(teamId),
    ]);

    const params = {
      FunctionName: storageConfig.lambdaFunctionName,
      InvocationType: InvocationType.RequestResponse,
      Payload: JSON.stringify({
        sourceBucket,
        fileKeys,
        folderStructure,
        watermarkConfig: watermarkConfig || { enabled: false },
        zipPartNumber,
        totalParts,
        dataroomName,
        zipFileName,
        expirationHours,
      }),
    };

    const command = new InvokeCommand(params);
    const response = await client.send(command);

    if (!response.Payload) {
      throw new Error("Lambda response payload is undefined or empty");
    }

    const decodedPayload = new TextDecoder().decode(response.Payload);
    const payload = JSON.parse(decodedPayload);

    // Check for Lambda errors
    if (payload.errorMessage) {
      throw new Error(`Lambda error: ${payload.errorMessage}`);
    }

    const body = JSON.parse(payload.body);

    // Parse the presigned URL to extract S3 key info for on-demand re-signing
    let s3KeyInfo: { bucket: string; key: string; region: string } | undefined;
    try {
      const { parseS3PresignedUrl } =
        await import("@/lib/files/bulk-download-presign");
      s3KeyInfo = parseS3PresignedUrl(body.downloadUrl);
    } catch {
      // Non-fatal: fall back to stored presigned URL
    }

    return res.status(200).json({ downloadUrl: body.downloadUrl, s3KeyInfo });
  } catch (error) {
    console.error("Error processing download batch:", error);
    return res.status(500).json({
      error: "Failed to process download batch",
      details: (error as Error).message,
    });
  }
}
