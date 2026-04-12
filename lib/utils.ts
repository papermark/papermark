import { NextRouter } from "next/router";

import slugify from "@sindresorhus/slugify";
import { upload } from "@vercel/blob/client";
import { transliterate } from "transliteration";
import bcrypt from "bcryptjs";
import * as chrono from "chrono-node";
import { type ClassValue, clsx } from "clsx";
import crypto from "crypto";
import ms from "ms";
import { customAlphabet } from "nanoid";
import { rgb } from "pdf-lib";
import { ParsedUrlQuery } from "querystring";
import { toast } from "sonner";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function classNames(...classes: string[]) {
  const uniqueClasses = Array.from(new Set(classes.join(" ").split(" ")));
  return uniqueClasses.join(" ");
}

export function getExtension(url: string) {
  // @ts-ignore
  return url.split(/[#?]/)[0].split(".").pop().trim();
}

/**
 * Ensures a filename has a .pdf extension for watermarked documents
 * Removes any existing extension and adds .pdf
 */
export function getFileNameWithPdfExtension(filename?: string): string {
  if (!filename) return "document.pdf";

  // Remove existing extension and add .pdf
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
  return `${nameWithoutExt}.pdf`;
}

interface SWRError extends Error {
  status: number;
}

export async function fetcher<JSON = any>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<JSON> {
  const res = await fetch(input, init);

  if (!res.ok) {
    const error = await res.text();
    const err = new Error(error) as SWRError;
    err.status = res.status;
    throw err;
  }

  return res.json();
}

export const logStore = async ({ object }: { object: any }) => {
  /* If in development or env variable not set, log to the console */
  if (
    process.env.NODE_ENV === "development" ||
    !process.env.PPMK_STORE_WEBHOOK_URL
  ) {
    console.log(object);
    return;
  }

  try {
    if (process.env.PPMK_STORE_WEBHOOK_URL) {
      return await fetch(process.env.PPMK_STORE_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(object),
      });
    }
  } catch (e) {
    console.error("Error logging store:", e);
    return;
  }
};

const LOG_TIMEOUT_MS = 2500;

const postJsonWithTimeout = async (
  url: string,
  body: unknown,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  timeoutId.unref?.();
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

export const log = async ({
  message,
  type,
  mention = false,
}: {
  message: string;
  type: "info" | "cron" | "links" | "error" | "trial";
  mention?: boolean;
}) => {
  /* If in development or env variable not set, log to the console */
  if (
    process.env.NODE_ENV === "development" ||
    !process.env.PPMK_SLACK_WEBHOOK_URL
  ) {
    console.log(message);
    return;
  }

  /* Log a message to channel */
  try {
    const payload = {
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            // prettier-ignore
            text: `${mention ? "<@U05BTDUKPLZ> " : ""}${type === "error" ? ":rotating_light: " : ""}${message}`,
          },
        },
      ],
    };

    if (type === "trial" && process.env.PPMK_TRIAL_SLACK_WEBHOOK_URL) {
      return await postJsonWithTimeout(
        process.env.PPMK_TRIAL_SLACK_WEBHOOK_URL,
        payload,
        LOG_TIMEOUT_MS,
      );
    }

    return await postJsonWithTimeout(
      `${process.env.PPMK_SLACK_WEBHOOK_URL}`,
      payload,
      LOG_TIMEOUT_MS,
    );
  } catch (e) {}
};

export function bytesToSize(bytes: number) {
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "n/a";
  const i = Math.floor(Math.log(bytes) / Math.log(1000));
  if (i === 0) return `${bytes} ${sizes[i]}`;
  const sizeInCurrentUnit = bytes / Math.pow(1000, i);
  if (sizeInCurrentUnit >= 1000 && i < sizes.length - 1) {
    return `1 ${sizes[i + 1]}`;
  }
  return `${Math.round(sizeInCurrentUnit)} ${sizes[i]}`;
}

const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
};

export const getDomainWithoutWWW = (url: string) => {
  if (isValidUrl(url)) {
    return new URL(url).hostname.replace(/^www\./, "");
  }
  try {
    if (url.includes(".") && !url.includes(" ")) {
      return new URL(`https://${url}`).hostname.replace(/^www\./, "");
    }
  } catch (e) {
    return "(direct)"; // Not a valid URL, but cannot return null
  }
};

export function capitalize(str: string) {
  if (!str || typeof str !== "string") return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export const timeAgo = (timestamp?: Date | string | number): string => {
  if (!timestamp) return "Just now";
  const date = new Date(timestamp);
  const diff = Date.now() - date.getTime();
  if (diff < 60000) {
    // less than 1 second
    return "Just now";
  } else if (diff > 82800000) {
    // more than 23 hours – similar to how Twitter displays timestamps
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year:
        date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    });
  }
  return `${ms(diff)} ago`;
};

export const timeIn = (timestamp?: Date): string => {
  if (!timestamp) return "Just now";
  const diff = new Date(timestamp).getTime() - Date.now();
  if (diff < 60000) {
    return "Just now";
  }
  return `in ${ms(diff, { long: true })}`;
};

export const durationFormat = (durationInMilliseconds?: number): string => {
  if (!durationInMilliseconds) return "0 secs";

  if (durationInMilliseconds < 60000) {
    return `${Math.round(durationInMilliseconds / 1000)} secs`;
  } else {
    const minutes = Math.floor(durationInMilliseconds / 60000);
    const seconds = Math.round((durationInMilliseconds % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")} mins`;
  }
};

export function nFormatter(num?: number, digits?: number) {
  if (!num) return "0";
  const lookup = [
    { value: 1, symbol: "" },
    { value: 1e3, symbol: "K" },
    { value: 1e6, symbol: "M" },
    { value: 1e9, symbol: "G" },
    { value: 1e12, symbol: "T" },
    { value: 1e15, symbol: "P" },
    { value: 1e18, symbol: "E" },
  ];
  const rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
  var item = lookup
    .slice()
    .reverse()
    .find(function (item) {
      return num >= item.value;
    });
  return item
    ? (num / item.value).toFixed(digits || 1).replace(rx, "$1") + item.symbol
    : "0";
}

export const getDateTimeLocal = (timestamp?: Date): string => {
  const d = timestamp ? new Date(timestamp) : new Date();
  if (d.toString() === "Invalid Date") return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .split(":")
    .slice(0, 2)
    .join(":");
};

export const formatDateTime = (
  datetime: Date | string,
  options?: Intl.DateTimeFormatOptions,
) => {
  if (datetime.toString() === "Invalid Date") return "";
  return new Date(datetime).toLocaleTimeString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: true,
    ...options,
  });
};

export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password, saltRounds);
  return hashedPassword;
}

export async function checkPassword(
  password: string,
  hashedPassword: string,
): Promise<boolean> {
  const match = await bcrypt.compare(password, hashedPassword);
  return match;
}

export function copyToClipboard(text: string, message: string): void {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      toast.success(message);
    })
    .catch((error) => {
      toast.warning("Please copy your link manually.");
    });
}

export const getFirstAndLastDay = (day: number) => {
  const today = new Date();
  const currentDay = today.getDate();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  if (currentDay >= day) {
    // if the current day is greater than target day, it means that we just passed it
    return {
      firstDay: new Date(currentYear, currentMonth, day),
      lastDay: new Date(currentYear, currentMonth + 1, day - 1),
    };
  } else {
    // if the current day is less than target day, it means that we haven't passed it yet
    const lastYear = currentMonth === 0 ? currentYear - 1 : currentYear; // if the current month is January, we need to go back a year
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1; // if the current month is January, we need to go back to December
    return {
      firstDay: new Date(lastYear, lastMonth, day),
      lastDay: new Date(currentYear, currentMonth, day - 1),
    };
  }
};

export const formatDate = (dateString: string, updateDate?: boolean) => {
  return new Date(dateString).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year:
      updateDate &&
      new Date(dateString).getFullYear() === new Date().getFullYear()
        ? undefined
        : "numeric",
    timeZone: "UTC",
  });
};

export const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  7,
); // 7-character random string

/**
 * CJK-safe slugify: transliterates non-Latin characters (CJK, Cyrillic, etc.)
 * to their romanized equivalents before slugifying, so the same input always
 * produces the same slug. e.g. "文件报告" → "wen-jian-bao-gao"
 */
export function safeSlugify(input: string): string {
  const slug = slugify(input);
  if (slug.length > 0) return slug;
  return slugify(transliterate(input)) || nanoid();
}

export const daysLeft = (
  accountCreationDate: Date,
  maxDays: number,
): number => {
  const now = new Date();
  const endPeriodDate = new Date(accountCreationDate);
  endPeriodDate.setDate(accountCreationDate.getDate() + maxDays);

  const diffInMilliseconds = endPeriodDate.getTime() - now.getTime();

  // Convert milliseconds to days and round down to show complete days remaining
  return Math.floor(diffInMilliseconds / (1000 * 60 * 60 * 24));
};

const cutoffDate = new Date("2023-10-17T00:00:00.000Z");

export const calculateDaysLeft = (accountCreationDate: Date): number => {
  let maxDays;
  if (accountCreationDate < cutoffDate) {
    maxDays = 30;
    accountCreationDate = new Date("2023-10-01T00:00:00.000Z");
  } else {
    maxDays = 14;
  }
  return daysLeft(accountCreationDate, maxDays);
};

export function constructMetadata({
  title = "Papermark | The Open Source DocSend Alternative",
  description = "Papermark is an open-source document sharing alternative to DocSend with built-in engagement analytics and 100% white-labeling.",
  image = "https://www.papermark.com/_static/meta-image.png",
  favicon = "/favicon.ico",
  noIndex = false,
}: {
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  noIndex?: boolean;
} = {}) {
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: image,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
      creator: "@papermarkio",
    },
    favicon,
    ...(noIndex && {
      robots: {
        index: false,
        follow: false,
      },
    }),
  };
}

export const isDataUrl = (str: string): boolean => {
  return str?.startsWith("data:");
};

export const convertDataUrlToFile = ({
  dataUrl,
  filename = "logo.png",
}: {
  dataUrl: string;
  filename?: string;
}) => {
  let arr = dataUrl.split(","),
    match = arr[0].match(/:(.*?);/),
    mime = match ? match[1] : "",
    bstr = atob(arr[1]),
    n = bstr.length,
    u8arr = new Uint8Array(n);

  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }

  filename =
    mime == "image/png"
      ? "logo.png"
      : mime == "image/jpeg"
        ? "logo.jpg"
        : filename;

  return new File([u8arr], filename, { type: mime });
};

export const convertDataUrlToBuffer = (
  dataUrl: string,
): { buffer: Buffer; mimeType: string; filename: string } => {
  // Extract mime type
  const match = dataUrl.match(/:(.*?);/);
  const mimeType = match ? match[1] : "";

  // Extract base64 data
  const base64Data = dataUrl.split(",")[1];
  const buffer = Buffer.from(base64Data, "base64");

  // Determine filename based on mime type
  const filename =
    mimeType === "image/png"
      ? "image.png"
      : mimeType === "image/jpeg"
        ? "image.jpg"
        : mimeType === "image/x-icon" || mimeType === "image/vnd.microsoft.icon"
          ? "favicon.ico"
          : "image";

  return { buffer, mimeType, filename };
};

export const validateImageDimensions = (
  image: string,
  minSize: number,
  maxSize: number,
): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = image;
    img.onload = () => {
      const { width, height } = img;
      if (
        width >= minSize &&
        height >= minSize &&
        width <= maxSize &&
        height <= maxSize
      ) {
        resolve(true);
      } else {
        resolve(false);
      }
    };
    img.onerror = () => {
      resolve(false);
    };
  });
};

export const uploadImage = async (
  file: File,
  uploadType: "profile" | "assets" = "assets",
) => {
  const newBlob = await upload(file.name, file, {
    access: "public",
    handleUploadUrl: `/api/file/image-upload?type=${uploadType}`,
  });

  return newBlob.url;
};

/**
 * Generates a Gravatar hash for the given email.
 * @param {string} email - The email address.
 * @returns {string} The Gravatar hash.
 */
export const generateGravatarHash = (email: string | null): string => {
  if (!email) return "";
  // 1. Trim leading and trailing whitespace from an email address
  const trimmedEmail = email.trim();

  // 2. Force all characters to lower-case
  const lowerCaseEmail = trimmedEmail.toLowerCase();

  // 3. Hash the final string with SHA256
  const hash = crypto.createHash("sha256").update(lowerCaseEmail).digest("hex");

  return hash;
};

export { getAvatarTheme } from "./avatar-theme";

export async function generateEncrpytedPassword(
  password: string,
): Promise<string> {
  // If the password is empty, return an empty string
  if (!password) return "";
  // If the password is already encrypted, return it
  // Check if it's encrypted by validating the format: 32-char hex IV + ":" + hex encrypted text
  const textParts: string[] = password.split(":");
  if (
    textParts.length === 2 &&
    textParts[0].length === 32 &&
    /^[a-fA-F0-9]+$/.test(textParts[0]) &&
    /^[a-fA-F0-9]+$/.test(textParts[1])
  ) {
    return password;
  }
  // Otherwise, encrypt the password
  const encryptedKey: string = crypto
    .createHash("sha256")
    .update(String(process.env.NEXT_PRIVATE_DOCUMENT_PASSWORD_KEY))
    .digest("base64")
    .substring(0, 32);
  const IV: Buffer = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-ctr", encryptedKey, IV);
  let encryptedText: string = cipher.update(password, "utf8", "hex");
  encryptedText += cipher.final("hex");
  return IV.toString("hex") + ":" + encryptedText;
}

export function decryptEncrpytedPassword(password: string): string {
  if (!password) return "";
  const encryptedKey: string = crypto
    .createHash("sha256")
    .update(String(process.env.NEXT_PRIVATE_DOCUMENT_PASSWORD_KEY))
    .digest("base64")
    .substring(0, 32);
  const textParts: string[] = password.split(":");
  // Check if it's in the expected encrypted format: 32-char hex IV + ":" + hex encrypted text
  if (
    !textParts ||
    textParts.length !== 2 ||
    textParts[0].length !== 32 ||
    !/^[a-fA-F0-9]+$/.test(textParts[0]) ||
    !/^[a-fA-F0-9]+$/.test(textParts[1])
  ) {
    return password; // Return as-is if not in encrypted format
  }
  try {
    const IV: Buffer = Buffer.from(textParts[0], "hex");
    const encryptedText: string = textParts[1];
    const decipher = crypto.createDecipheriv("aes-256-ctr", encryptedKey, IV);
    let decrypted: string = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    return password;
  }
}

type FilterMode = "email" | "domain" | "both";

export const sanitizeList = (
  list: string,
  mode: FilterMode = "both",
): string[] => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const domainRegex = /^@[^\s@]+\.[^\s@]+$/;

  const sanitized = list
    .split("\n")
    .map((item) => item.trim().replace(/,$/, "").toLowerCase())
    .filter((item) => item !== "")
    .filter((item) => {
      if (mode === "email") return emailRegex.test(item);
      if (mode === "domain") return domainRegex.test(item);
      return emailRegex.test(item) || domainRegex.test(item);
    });

  return [...new Set(sanitized)];
};

export function hexToRgb(hex: string) {
  let bigint = parseInt(hex.slice(1), 16);
  let r = ((bigint >> 16) & 255) / 255; // Convert to 0-1 range
  let g = ((bigint >> 8) & 255) / 255; // Convert to 0-1 range
  let b = (bigint & 255) / 255; // Convert to 0-1 range
  return rgb(r, g, b);
}

export const trim = (u: unknown) => (typeof u === "string" ? u.trim() : u);

export const getBreadcrumbPath = (path: string[]) => {
  const segments = path?.filter(Boolean);
  if (!Array.isArray(path) || path.length === 0) {
    return [{ name: "Home", pathLink: "/documents" }];
  }
  let currentPath = "documents/tree";

  return [
    { name: "Home", pathLink: "/documents" },
    ...segments.map((segment, index) => {
      currentPath += `/${safeSlugify(segment)}`;
      return {
        name: segment,
        pathLink: currentPath,
      };
    }),
  ];
};

export const handleInvitationStatus = (
  invitationStatus: "accepted" | "teamMember",
  queryParams: ParsedUrlQuery,
  router: NextRouter,
) => {
  switch (invitationStatus) {
    case "accepted":
      toast.success("Welcome to the team! You've successfully joined.");
      break;
    case "teamMember":
      toast.error("You've already accepted this invitation!");
      break;
    default:
      toast.error("Invalid invitation status");
  }

  delete queryParams["invitation"];
  router.replace("/documents", undefined, {
    shallow: true,
  });
};

/**
 * Preset options for the expiration time of a link.
 * @type {Array<{ label: string, value: number }>}
 */

export const PRESET_OPTIONS: { label: string; value: number }[] = [
  { label: "in 1 hour", value: 3600 },
  { label: "in 6 hours", value: 21600 },
  { label: "in 12 hours", value: 43200 },
  { label: "in 1 day", value: 86400 },
  { label: "in 3 days", value: 259200 },
  { label: "in 7 days", value: 604800 },
  { label: "in 14 days", value: 1209600 },
  { label: "in 1 month", value: 2592000 },
  { label: "in 3 months", value: 7776000 },
  { label: "in 6 months", value: 15552000 },
  { label: "in 1 year", value: 31536000 },
];
export const WITH_CUSTOM_PRESET_OPTION: {
  label: string;
  value: number | string;
}[] = [...PRESET_OPTIONS, { label: "Custom", value: "custom" }];

export const formatExpirationTime = (seconds: number) => {
  // Define constants for time units
  const MINUTE = 60;
  const HOUR = 3600;
  const DAY = 86400;
  const YEAR = 31536000;

  seconds = Math.ceil(seconds / MINUTE) * MINUTE;

  if (seconds < MINUTE) {
    return "Less than a minute";
  }

  // Return exact unit match if possible
  if (seconds % YEAR === 0) {
    const years = seconds / YEAR;
    return `${years} year${years !== 1 ? "s" : ""}`;
  }

  if (seconds % DAY === 0) {
    const days = seconds / DAY;
    return `${days} day${days !== 1 ? "s" : ""}`;
  }

  if (seconds % HOUR === 0 && seconds < DAY) {
    const hours = seconds / HOUR;
    return `${hours} hour${hours !== 1 ? "s" : ""}`;
  }

  if (seconds % MINUTE === 0 && seconds < HOUR) {
    const minutes = seconds / MINUTE;
    return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }

  // Mixed unit fallbacks
  if (seconds < HOUR) {
    const minutes = Math.floor(seconds / MINUTE);
    return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }

  if (seconds < DAY) {
    const hours = Math.floor(seconds / HOUR);
    const minutes = Math.floor((seconds % HOUR) / MINUTE);
    return (
      `${hours} hour${hours !== 1 ? "s" : ""}` +
      (minutes > 0 ? ` and ${minutes} minute${minutes !== 1 ? "s" : ""}` : "")
    );
  }

  if (seconds < YEAR) {
    const days = Math.floor(seconds / DAY);
    const remainingSeconds = seconds % DAY;
    const hours = Math.floor(remainingSeconds / HOUR);
    const minutes = Math.floor((remainingSeconds % HOUR) / MINUTE);

    let result = `${days} day${days !== 1 ? "s" : ""}`;

    if (hours > 0 && minutes > 0) {
      result += `, ${hours} hour${hours !== 1 ? "s" : ""} and ${minutes} minute${minutes !== 1 ? "s" : ""}`;
    } else if (hours > 0) {
      result += ` and ${hours} hour${hours !== 1 ? "s" : ""}`;
    } else if (minutes > 0) {
      result += ` and ${minutes} minute${minutes !== 1 ? "s" : ""}`;
    }

    return result;
  }

  // Years + remaining time
  const years = Math.floor(seconds / YEAR);
  const remainingSeconds = seconds % YEAR;
  const days = Math.floor(remainingSeconds / DAY);
  const hours = Math.floor((remainingSeconds % DAY) / HOUR);
  const minutes = Math.floor((remainingSeconds % HOUR) / MINUTE);

  let result = `${years} year${years !== 1 ? "s" : ""}`;

  if (days > 0) {
    result += `, ${days} day${days !== 1 ? "s" : ""}`;
  }
  if (hours > 0) {
    result += `, ${hours} hour${hours !== 1 ? "s" : ""}`;
  }
  if (minutes > 0) {
    result += ` and ${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }

  return result;
};

// from DUB.IO
export const parseDateTime = (str: Date | string) => {
  if (str instanceof Date) return str;
  return chrono.parseDate(str);
};

/**
 * Safely replaces template variables in user input with actual values.
 * Only allows whitelisted variables to prevent template injection.
 */
export function safeTemplateReplace(
  template: string,
  data: Record<string, any>,
): string {
  // Define allowed template variables - only these will be replaced
  const allowedVariables = ["email", "date", "time", "link", "ipAddress"];

  let result = template;

  for (const key of allowedVariables) {
    if (data[key] !== undefined && data[key] !== null) {
      // Use a regex to match {{variable}} patterns with optional whitespace
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, "gi");
      result = result.replace(regex, String(data[key]));
    }
  }

  return result;
}

/**
 * Converts BigInt fileSize values to numbers for safe serialization
 * Recursively processes objects and arrays, converting only fileSize fields
 */
export function serializeFileSize(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(serializeFileSize);
  }

  if (typeof obj === "object") {
    const serialized: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        if (key === "fileSize" && typeof obj[key] === "bigint") {
          // Convert BigInt fileSize to number
          serialized[key] = Number(obj[key]);
        } else {
          serialized[key] = serializeFileSize(obj[key]);
        }
      }
    }
    return serialized;
  }

  return obj;
}
