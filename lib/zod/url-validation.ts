import { parsePageId } from "notion-utils";
import { z } from "zod";

import {
  SUPPORTED_DOCUMENT_MIME_TYPES,
  SUPPORTED_DOCUMENT_SIMPLE_TYPES,
} from "@/lib/constants";
import {
  getNotionPageIdFromSlug,
  isCustomNotionDomain,
  isStandardNotionHostname,
} from "@/lib/notion/utils";
import { isPublicHostnameLiteral } from "@/lib/utils/ssrf-protection";
import { getSupportedContentType } from "@/lib/utils/get-content-type";
import { sanitizePlainText } from "@/lib/utils/sanitize-html";

/**
 * Validates basic security aspects of paths and URLs
 * Prevents directory traversal, null byte injection, and double encoding attacks
 */
export const validatePathSecurity = (pathOrUrl: string): boolean => {
  // Prevent directory traversal attacks
  if (pathOrUrl.includes("../") || pathOrUrl.includes("..\\")) {
    return false;
  }

  // Prevent null byte attacks
  if (pathOrUrl.includes("\0")) {
    return false;
  }

  // Prevent double encoding attacks
  if (pathOrUrl.includes("%2E%2E") || pathOrUrl.includes("%2F%2F")) {
    return false;
  }

  return true;
};

/**
 * Validates URL for SSRF protection
 * Blocks internal/private IP ranges, localhost, and link-local addresses
 */
export const validateUrlSSRFProtection = (url: string): boolean => {
  try {
    const urlObj = new URL(url);
    if (urlObj.username || urlObj.password) {
      return false;
    }

    // Synchronous validation only catches literal hosts. Network fetchers must
    // resolve DNS and re-check redirect targets before connecting.
    return isPublicHostnameLiteral(urlObj.hostname);
  } catch {
    return false;
  }
};

/**
 * Comprehensive security validation for URLs
 * Combines path security and SSRF protection
 */
export const validateUrlSecurity = (url: string): boolean => {
  return validatePathSecurity(url) && validateUrlSSRFProtection(url);
};

// Custom validator for file paths - either Notion URLs or S3 storage paths
// Note: General URLs for link type are validated at the documentUploadSchema level
const createFilePathValidator = () => {
  return z
    .string()
    .min(1, "File path is required")
    .refine(
      async (path) => {
        // Case 1: Notion URLs - must start with notion domains
        if (path.startsWith("https://")) {
          try {
            const urlObj = new URL(path);
            const hostname = urlObj.hostname;

            const isValidNotionDomain = isStandardNotionHostname(hostname);

            // Check for vercel blob storage
            let isVercelBlob = false;
            if (process.env.VERCEL_BLOB_HOST) {
              isVercelBlob = hostname.startsWith(process.env.VERCEL_BLOB_HOST);
            }

            // If it's not a standard Notion domain or Vercel blob, check if it's a custom Notion domain
            if (!isValidNotionDomain && !isVercelBlob) {
              try {
                let pageId = parsePageId(path);
                if (!pageId) {
                  const pageIdFromSlug = await getNotionPageIdFromSlug(path);
                  if (pageIdFromSlug) {
                    pageId = pageIdFromSlug;
                  }
                }
                return !!pageId;
              } catch {
                return false;
              }
            }

            return isValidNotionDomain || isVercelBlob;
          } catch {
            return false;
          }
        }

        // Case 2: file storage paths - must match pattern: <id>/doc_<someId>/<name>.<ext>
        const s3PathPattern =
          /^[a-zA-Z0-9_-]+\/doc_[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+$/;
        return s3PathPattern.test(path);
      },
      {
        message:
          "File path must be either a Notion URL or an file storage path",
      },
    )
    .refine(
      (path) => {
        // Additional security checks for all paths
        return validatePathSecurity(path);
      },
      {
        message: "File path contains invalid or malicious characters",
      },
    );
};

// File path validation schema
export const filePathSchema = createFilePathValidator();

// Dedicated Notion URL validation schema for URL updates
export const notionUrlUpdateSchema = z
  .string()
  .url("Invalid URL format")
  .refine((url) => url.startsWith("https://"), {
    message: "Notion URL must use HTTPS",
  })
  .refine(
    async (url) => {
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;

        const isValidNotionDomain = isStandardNotionHostname(hostname);

        // If it's a standard Notion domain, try to extract page ID
        if (isValidNotionDomain) {
          let pageId = parsePageId(url);
          if (!pageId) {
            try {
              const pageIdFromSlug = await getNotionPageIdFromSlug(url);
              pageId = pageIdFromSlug || undefined;
            } catch {
              return false;
            }
          }
          return !!pageId;
        }

        // For custom domains, try to extract and validate page ID
        try {
          let pageId = parsePageId(url);
          if (!pageId) {
            const pageIdFromSlug = await getNotionPageIdFromSlug(url);
            pageId = pageIdFromSlug || undefined;
          }
          return !!pageId;
        } catch {
          return false;
        }
      } catch {
        return false;
      }
    },
    {
      message:
        "Must be a valid Notion URL (supports app.notion.com, notion.com, notion.so, notion.site, and custom domains)",
    },
  )
  .refine(
    (url) => {
      // Additional security checks
      return validatePathSecurity(url) && validateUrlSSRFProtection(url);
    },
    {
      message: "URL contains invalid characters or targets internal resources",
    },
  );

// Document upload validation schema with comprehensive type and content validation
export const documentUploadSchema = z
  .object({
    name: z
      .string()
      .max(10000, "Document name too long")
      .transform((value) => sanitizePlainText(value))
      .pipe(
        z
          .string()
          .min(1, "Document name is required")
          .max(255, "Document name too long"),
      ),
    url: z.string().min(1, "URL is required"), // Use string for now, will validate based on type
    storageType: z
      .enum(["S3_PATH", "VERCEL_BLOB"], {
        errorMap: () => ({ message: "Invalid storage type" }),
      })
      .default("VERCEL_BLOB")
      .optional(),
    numPages: z.number().int().positive().optional(),
    type: z.enum(
      SUPPORTED_DOCUMENT_SIMPLE_TYPES as unknown as readonly [
        string,
        ...string[],
      ],
      {
        errorMap: () => ({
          message: `File type must be one of: ${SUPPORTED_DOCUMENT_SIMPLE_TYPES.join(", ")}`,
        }),
      },
    ),
    folderPathName: z.string().optional(),
    contentType: z
      .enum(
        SUPPORTED_DOCUMENT_MIME_TYPES as unknown as readonly [
          string,
          ...string[],
        ],
        {
          errorMap: () => ({ message: "Unsupported content type" }),
        },
      )
      .or(z.literal("text/html")) // Allow text/html for Notion documents
      .nullish(), // Make contentType optional for Notion files and links
    createLink: z.boolean().optional(),
    fileSize: z.number().int().positive().optional(),
  })
  .refine(
    async (data) => {
      // For link type, validate URL format and security
      if (data.type === "link") {
        if (!data.url.startsWith("https://")) {
          return false;
        }
        try {
          new URL(data.url); // Validate URL format
          return validateUrlSecurity(data.url);
        } catch {
          return false;
        }
      }
      // For other types, use the file path validator
      return await filePathSchema.safeParseAsync(data.url).then((r) => r.success);
    },
    {
      message: "URL must be a valid HTTPS URL for link type, or a valid file path for other types",
      path: ["url"],
    },
  )
  .refine(
    (data) => {
      // Skip content type validation if it's not provided (e.g., for Notion files or links)
      if (!data.contentType) {
        return data.type === "notion" || data.type === "link";
      }

      // For link type, content type is optional
      if (data.type === "link") {
        return true;
      }

      // Validate that content type matches the declared file type
      const expectedType = getSupportedContentType(data.contentType);

      // Special case for Notion documents
      if (data.contentType === "text/html" && data.type === "notion") {
        return true;
      }

      return expectedType === data.type;
    },
    {
      message: "Content type does not match the declared file type",
      path: ["contentType"], // This will highlight the contentType field in errors
    },
  )
  .refine(
    async (data) => {
      // For link type, storage type is not required and URL validation is handled elsewhere
      if (data.type === "link") {
        return true;
      }

      // Skip storage type validation if not provided (e.g., for Notion files)
      if (!data.storageType) {
        // For Notion URLs, storage type is not required
        if (data.url.startsWith("https://")) {
          try {
            const urlObj = new URL(data.url);
            const hostname = urlObj.hostname;
            if (isStandardNotionHostname(hostname)) {
              return true;
            }

            // Check if it's a custom Notion domain
            try {
              return await isCustomNotionDomain(data.url);
            } catch {
              return false;
            }
          } catch {
            return false;
          }
        }
        // For file paths without storage type, this is invalid
        return false;
      }

      // Validate storage type consistency with path format
      if (data.storageType === "S3_PATH") {
        // S3_PATH should use file paths, not URLs
        return !data.url.startsWith("https://");
      } else if (data.storageType === "VERCEL_BLOB") {
        // VERCEL_BLOB can use either Notion URLs or S3 paths (for migration)
        if (data.url.startsWith("https://")) {
          // Must be a Notion URL for VERCEL_BLOB
          try {
            const urlObj = new URL(data.url);
            const hostname = urlObj.hostname;

            if (isStandardNotionHostname(hostname)) {
              return true;
            }

            // Check if it's a custom Notion domain
            try {
              return await isCustomNotionDomain(data.url);
            } catch {
              return false;
            }
          } catch {
            return false;
          }
        }
        // Or an S3 path (allowed for migration)
        return /^[a-zA-Z0-9_-]+\/doc_[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+$/.test(
          data.url,
        );
      }
      return false;
    },
    {
      message:
        "Storage type does not match the URL/path format, or missing storage type for non-Notion files",
      path: ["storageType"],
    },
  );

// Link URL update validation schema
export const linkUrlUpdateSchema = z
  .string()
  .url("Invalid URL format")
  .refine((url) => url.startsWith("https://"), {
    message: "Link URL must use HTTPS",
  })
  .refine(
    (url) => {
      // Security validation including SSRF protection
      return validateUrlSecurity(url);
    },
    {
      message: "URL contains invalid characters or targets internal resources",
    },
  );

// Webhook file URL validator - only allows trusted external sources for webhooks
export const webhookFileUrlSchema = z
  .string()
  .url("Invalid URL format")
  .refine(
    (url) => {
      // Must use HTTPS
      return url.startsWith("https://");
    },
    {
      message: "Webhook file URL must use HTTPS protocol",
    },
  )
  .refine(
    (url) => {
      // Comprehensive security validation including SSRF protection
      return validateUrlSecurity(url);
    },
    {
      message:
        "Webhook file URL contains invalid characters or targets internal resources",
    },
  );
