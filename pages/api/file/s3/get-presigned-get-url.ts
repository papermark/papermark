import { NextApiRequest, NextApiResponse } from "next";

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl as getCloudfrontSignedUrl } from "@aws-sdk/cloudfront-signer";
import { getSignedUrl as getS3SignedUrl } from "@aws-sdk/s3-request-presigner";

import { ONE_HOUR, ONE_SECOND, TWO_MINUTES } from "@/lib/constants";
import { getTeamS3ClientAndConfig } from "@/lib/files/aws-client";
import { log } from "@/lib/utils";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).end("Method Not Allowed");
  }

  // Extract the API Key from the Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1]; // Assuming the format is "Bearer [token]"

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Check if the API Key matches
  if (!process.env.INTERNAL_API_KEY) {
    log({
      message: "INTERNAL_API_KEY environment variable is not set",
      type: "error",
    });
    return res.status(500).json({ message: "Server configuration error" });
  }
  if (token !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const {
    key,
    expiresIn: requestedExpiresIn,
    responseContentDisposition,
  } = req.body as {
    key: string;
    expiresIn?: number;
    responseContentDisposition?: string;
  };

  const expiration = Math.min(requestedExpiresIn || TWO_MINUTES, ONE_HOUR);

  try {
    // Extract teamId from key (format: teamId/docId/filename)
    const teamId = key.split("/")[0];
    if (!teamId) {
      log({
        message: `Invalid key format: ${key}`,
        type: "error",
      });
      return res.status(400).json({ error: "Invalid key format" });
    }

    const { client, config } = await getTeamS3ClientAndConfig(teamId);

    if (config.distributionHost) {
      const distributionUrl = new URL(
        key,
        `https://${config.distributionHost}`,
      );

      if (!responseContentDisposition) {
        const url = getCloudfrontSignedUrl({
          url: distributionUrl.toString(),
          keyPairId: `${config.distributionKeyId}`,
          privateKey: `${config.distributionKeyContents}`,
          dateLessThan: new Date(Date.now() + expiration).toISOString(),
        });

        return res.status(200).json({ url });
      }

      // Use a custom policy (wildcard resource) when overriding
      // Content-Disposition. The RFC 5987 `filename*=UTF-8''...` syntax
      // contains `''`, which the canned-policy path can't sign correctly:
      // the signer leaves `'` literal (encodeURIComponent), but browsers
      // re-encode it to `%27` on send, so the URL no longer matches what
      // was signed and CloudFront returns AccessDenied. Signing the
      // Policy JSON instead of the URL bytes sidesteps the mismatch.
      distributionUrl.searchParams.set(
        "response-content-disposition",
        responseContentDisposition,
      );

      const resourceBase = `https://${config.distributionHost}${distributionUrl.pathname}`;
      const policy = JSON.stringify({
        Statement: [
          {
            Resource: `${resourceBase}?*`,
            Condition: {
              DateLessThan: {
                "AWS:EpochTime": Math.floor(
                  (Date.now() + expiration) / ONE_SECOND,
                ),
              },
            },
          },
        ],
      });

      const url = getCloudfrontSignedUrl({
        url: distributionUrl.toString(),
        policy,
        keyPairId: `${config.distributionKeyId}`,
        privateKey: `${config.distributionKeyContents}`,
      });

      return res.status(200).json({ url });
    }

    const getObjectCommand = new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ...(responseContentDisposition
        ? { ResponseContentDisposition: responseContentDisposition }
        : {}),
    });

    const url = await getS3SignedUrl(client, getObjectCommand, {
      expiresIn: expiration / ONE_SECOND,
    });

    return res.status(200).json({ url });
  } catch (error) {
    log({
      message: `Error getting presigned get url for ${key} \n\n ${error}`,
      type: "error",
    });
    return res
      .status(500)
      .json({ error: "AWS Cloudfront Signed URL Error", message: error });
  }
}
