import { getFeatureFlags } from "@/lib/featureFlags";

export interface StorageConfig {
  bucket: string;
  advancedBucket?: string;
  archiveBucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  distributionHost?: string;
  advancedDistributionHost?: string;
  distributionKeyId?: string;
  distributionKeyContents?: string;
  lambdaFunctionName?: string;
}

export type StorageRegion = "eu-central-1" | "us-east-2";

/**
 * Gets AWS storage configuration based on the storage region.
 * Uses environment variables with _US suffix for US region, no suffix for EU region.
 *
 * @param storageRegion - The storage region ('us-east-2' for US, defaults to 'eu-central-1' for EU)
 * @returns StorageConfig object with all necessary AWS configuration
 */
export function getStorageConfig(storageRegion?: string): StorageConfig {
  const isUS = storageRegion === "us-east-2";
  const suffix = isUS ? "_US" : "";

  // Get base environment variables with optional suffix
  const getBucket = () => {
    const bucketVar = `NEXT_PRIVATE_UPLOAD_BUCKET${suffix}`;
    const bucket = process.env[bucketVar];
    if (!bucket) {
      throw new Error(`Missing environment variable: ${bucketVar}`);
    }
    return bucket;
  };

  const getAccessKeyId = () => {
    const keyVar = `NEXT_PRIVATE_UPLOAD_ACCESS_KEY_ID${suffix}`;
    const key = process.env[keyVar];
    if (!key) {
      throw new Error(`Missing environment variable: ${keyVar}`);
    }
    return key;
  };

  const getSecretAccessKey = () => {
    const secretVar = `NEXT_PRIVATE_UPLOAD_SECRET_ACCESS_KEY${suffix}`;
    const secret = process.env[secretVar];
    if (!secret) {
      throw new Error(`Missing environment variable: ${secretVar}`);
    }
    return secret;
  };

  const getRegion = () => {
    const regionVar = `NEXT_PRIVATE_UPLOAD_REGION${suffix}`;
    return process.env[regionVar] || (isUS ? "us-east-2" : "eu-central-1");
  };

  const getArchiveBucket = () => {
    const archiveBucketVar = `NEXT_PRIVATE_ARCHIVE_BUCKET${suffix}`;
    const archiveBucket = process.env[archiveBucketVar];
    if (!archiveBucket) {
      throw new Error(`Missing environment variable: ${archiveBucketVar}`);
    }
    return archiveBucket;
  };

  return {
    bucket: getBucket(),
    advancedBucket: process.env[`NEXT_PRIVATE_ADVANCED_UPLOAD_BUCKET${suffix}`],
    archiveBucket: getArchiveBucket(),
    region: getRegion(),
    accessKeyId: getAccessKeyId(),
    secretAccessKey: getSecretAccessKey(),
    endpoint: process.env[`NEXT_PRIVATE_UPLOAD_ENDPOINT${suffix}`],
    distributionHost:
      process.env[`NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST${suffix}`],
    advancedDistributionHost:
      process.env[`NEXT_PRIVATE_ADVANCED_UPLOAD_DISTRIBUTION_HOST${suffix}`],
    distributionKeyId:
      process.env[`NEXT_PRIVATE_UPLOAD_DISTRIBUTION_KEY_ID${suffix}`],
    distributionKeyContents:
      process.env[`NEXT_PRIVATE_UPLOAD_DISTRIBUTION_KEY_CONTENTS${suffix}`],
    lambdaFunctionName:
      process.env[`NEXT_PRIVATE_LAMBDA_FUNCTION_NAME${suffix}`],
  };
}

/**
 * Gets storage configuration for a team using feature flags.
 * This is the main function that should be used by file operations.
 *
 * @param teamId - The team ID to get storage configuration for
 * @returns Promise<StorageConfig> - The storage configuration for the team
 */
export async function getTeamStorageConfigById(
  teamId: string,
): Promise<StorageConfig> {
  try {
    const features = await getFeatureFlags({ teamId });

    // If team has usStorage feature flag enabled, use US region
    const storageRegion = features.usStorage ? "us-east-2" : undefined;

    return getStorageConfig(storageRegion);
  } catch (error) {
    console.warn(
      "Failed to resolve storage region for team %s:",
      teamId,
      error,
    );
    return getStorageConfig(); // Default to EU region on error
  }
}
