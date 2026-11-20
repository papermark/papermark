import sanitizeHtml from "sanitize-html";
import { decodeHTML } from "entities";

import { MAX_MESSAGE_LENGTH } from "@/lib/constants";

const plainTextSanitizeConfig = {
  allowedTags: [],
  allowedAttributes: {},
};

const controlCharsRegex = /[\u0000-\u001F\u007F-\u009F]/g;
const invisibleControlRegex = /[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g;

export function sanitizePlainText(content: string) {
  const sanitized = sanitizeHtml(content, plainTextSanitizeConfig);
  const decoded = decodeHTML(sanitized).normalize("NFC");

  return decoded
    .replace(controlCharsRegex, " ")
    .replace(invisibleControlRegex, "")
    .trim();
}

export function validateContent(html: string, length: number = MAX_MESSAGE_LENGTH) {
  if (html.length > length) {
    throw new Error(`Content cannot be longer than ${length} characters`);
  }
  const sanitized = sanitizePlainText(html);

  if (sanitized.length === 0 || sanitized === "") {
    throw new Error("Content cannot be empty");
  }

  return sanitized;
}
