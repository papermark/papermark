import { lookup } from "node:dns/promises";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_READ_TIMEOUT_MS = 60_000;

type ResolvedPublicAddress = {
  address: string;
  family: 4 | 6;
  hostname: string;
  hostnameIsIp: boolean;
};

type RemoteHttpResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: IncomingMessage;
  clearReadTimer: () => void;
  refreshReadTimer: () => void;
};

export class ConnectionTimeoutError extends Error {
  readonly code = "CONNECT_TIMEOUT" as const;
  constructor(message = "Connection to URL timed out.") {
    super(message);
    this.name = "ConnectionTimeoutError";
  }
}

export class ReadTimeoutError extends Error {
  readonly code = "READ_TIMEOUT" as const;
  constructor(message = "Reading response body from URL timed out.") {
    super(message);
    this.name = "ReadTimeoutError";
  }
}

export type PublicHttpsDownload = {
  buffer: Buffer;
  contentType: string;
  finalUrl: URL;
  headers: IncomingHttpHeaders;
};

export function normalizeHostnameForSSRF(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  const withoutBrackets =
    normalized.startsWith("[") && normalized.endsWith("]")
      ? normalized.slice(1, -1)
      : normalized;

  return withoutBrackets.endsWith(".")
    ? withoutBrackets.slice(0, -1)
    : withoutBrackets;
}

function parseIpv4Bytes(address: string): number[] | null {
  if (isIP(address) !== 4) return null;

  const octets = address.split(".").map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }

  return octets;
}

function parseIpv6Bytes(address: string): number[] | null {
  const normalized = normalizeHostnameForSSRF(address);
  if (isIP(normalized) !== 6) return null;

  let expanded = normalized;
  const ipv4Tail = normalized.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Tail) {
    const ipv4Bytes = parseIpv4Bytes(ipv4Tail[1]);
    if (!ipv4Bytes) return null;

    const firstGroup = (ipv4Bytes[0] << 8) + ipv4Bytes[1];
    const secondGroup = (ipv4Bytes[2] << 8) + ipv4Bytes[3];
    expanded = `${normalized.slice(0, -ipv4Tail[1].length)}${firstGroup.toString(16)}:${secondGroup.toString(16)}`;
  }

  const halves = expanded.split("::");
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const missingGroups = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missingGroups !== 0) ||
    (halves.length === 2 && missingGroups < 1)
  ) {
    return null;
  }

  const groups = [...left, ...Array(missingGroups).fill("0"), ...right];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }

  return bytes;
}

function isReservedIpv4Bytes(bytes: number[]): boolean {
  const [first, second, third] = bytes;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function hasIpv6Prefix(
  bytes: number[],
  prefixBytes: number[],
  prefixBits: number,
): boolean {
  for (let bit = 0; bit < prefixBits; bit++) {
    const byteIndex = Math.floor(bit / 8);
    const mask = 1 << (7 - (bit % 8));
    if ((bytes[byteIndex] & mask) !== ((prefixBytes[byteIndex] ?? 0) & mask)) {
      return false;
    }
  }

  return true;
}

function getIpv4MappedBytes(ipv6Bytes: number[]): number[] | null {
  const isMapped =
    ipv6Bytes.slice(0, 10).every((byte) => byte === 0) &&
    ipv6Bytes[10] === 0xff &&
    ipv6Bytes[11] === 0xff;

  return isMapped ? ipv6Bytes.slice(12, 16) : null;
}

function isPrivateOrReservedIpAddress(address: string): boolean {
  const normalized = normalizeHostnameForSSRF(address);

  const ipv4Bytes = parseIpv4Bytes(normalized);
  if (ipv4Bytes) {
    return isReservedIpv4Bytes(ipv4Bytes);
  }

  const ipv6Bytes = parseIpv6Bytes(normalized);
  if (!ipv6Bytes) return false;

  const mappedIpv4Bytes = getIpv4MappedBytes(ipv6Bytes);
  if (mappedIpv4Bytes) {
    return true;
  }

  const nat64MappedIpv4Bytes = hasIpv6Prefix(ipv6Bytes, [0x64, 0xff, 0x9b], 96)
    ? ipv6Bytes.slice(12, 16)
    : null;
  if (nat64MappedIpv4Bytes) {
    return isReservedIpv4Bytes(nat64MappedIpv4Bytes);
  }

  return (
    ipv6Bytes.every((byte) => byte === 0) ||
    (ipv6Bytes.slice(0, 15).every((byte) => byte === 0) &&
      ipv6Bytes[15] === 1) ||
    // Deprecated IPv4-compatible IPv6 form (::/96).
    hasIpv6Prefix(ipv6Bytes, [], 96) ||
    hasIpv6Prefix(ipv6Bytes, [0x01, 0x00], 64) ||
    hasIpv6Prefix(ipv6Bytes, [0x20, 0x01, 0x00, 0x02, 0x00, 0x00], 48) ||
    hasIpv6Prefix(ipv6Bytes, [0x20, 0x01, 0x0d, 0xb8], 32) ||
    hasIpv6Prefix(ipv6Bytes, [0x3f, 0xff], 20) ||
    (ipv6Bytes[0] & 0xfe) === 0xfc ||
    (ipv6Bytes[0] === 0xfe && (ipv6Bytes[1] & 0xc0) === 0x80) ||
    ipv6Bytes[0] === 0xff
  );
}

export function isPublicHostnameLiteral(hostname: string): boolean {
  const normalizedHostname = normalizeHostnameForSSRF(hostname);

  if (
    !normalizedHostname ||
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname.endsWith(".local")
  ) {
    return false;
  }

  return !isPrivateOrReservedIpAddress(normalizedHostname);
}

async function resolvePublicHostname(
  hostname: string,
): Promise<ResolvedPublicAddress> {
  const normalizedHostname = normalizeHostnameForSSRF(hostname);

  if (!isPublicHostnameLiteral(normalizedHostname)) {
    throw new Error("URL must point to a public host.");
  }

  const hostnameIpVersion = isIP(normalizedHostname);
  if (hostnameIpVersion) {
    return {
      address: normalizedHostname,
      family: hostnameIpVersion as 4 | 6,
      hostname: normalizedHostname,
      hostnameIsIp: true,
    };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(normalizedHostname, { all: true, verbatim: true });
  } catch {
    throw new Error("URL hostname could not be resolved.");
  }

  if (addresses.length === 0) {
    throw new Error("URL hostname could not be resolved.");
  }

  if (addresses.some((entry) => isPrivateOrReservedIpAddress(entry.address))) {
    throw new Error("URL must not resolve to a private or local IP address.");
  }

  const selected = addresses[0];
  return {
    address: selected.address,
    family: selected.family as 4 | 6,
    hostname: normalizedHostname,
    hostnameIsIp: false,
  };
}

function getHeaderValue(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

async function requestResolvedHttpsUrl(
  url: URL,
  resolvedAddress: ResolvedPublicAddress,
  {
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    readTimeoutMs = DEFAULT_READ_TIMEOUT_MS,
  }: { connectTimeoutMs?: number; readTimeoutMs?: number } = {},
): Promise<RemoteHttpResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const request = httpsRequest(
      {
        protocol: "https:",
        host: resolvedAddress.address,
        family: resolvedAddress.family,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Host: url.host,
        },
        servername: resolvedAddress.hostnameIsIp
          ? undefined
          : resolvedAddress.hostname,
      },
      (response) => {
        if (settled) {
          response.destroy();
          return;
        }
        settled = true;
        // Disable the socket-level connect timeout now that headers are in.
        request.setTimeout(0);

        let readTimer: NodeJS.Timeout | null = null;

        const clearReadTimer = () => {
          if (readTimer) {
            clearTimeout(readTimer);
            readTimer = null;
          }
        };

        // Restart the inactivity deadline so an active transfer is not
        // mistakenly treated as a stalled one. Safe to call after clear.
        const refreshReadTimer = () => {
          if (readTimer) {
            clearTimeout(readTimer);
          }
          readTimer = setTimeout(() => {
            readTimer = null;
            response.destroy(new ReadTimeoutError());
          }, readTimeoutMs);
        };

        refreshReadTimer();

        // Safety net: clear the timer if the stream ends, closes, or errors
        // without going through readResponseBuffer (e.g. discarded redirects).
        response.once("close", clearReadTimer);
        response.once("error", clearReadTimer);

        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          clearReadTimer,
          refreshReadTimer,
        });
      },
    );

    request.setTimeout(connectTimeoutMs);
    request.once("timeout", () => {
      if (settled) return;
      settled = true;
      const error = new ConnectionTimeoutError();
      request.destroy(error);
      reject(error);
    });

    request.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    request.end();
  });
}

async function readResponseBuffer(
  response: IncomingMessage,
  maxBytes: number,
  clearReadTimer: () => void,
  refreshReadTimer: () => void,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  return new Promise((resolve, reject) => {
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearReadTimer();
      response.destroy();
      reject(error);
    };

    response.on("data", (chunk: Buffer | string) => {
      refreshReadTimer();
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > maxBytes) {
        fail(new Error("URL response exceeds the maximum allowed size."));
        return;
      }

      chunks.push(buffer);
    });

    response.on("end", () => {
      if (settled) return;
      settled = true;
      clearReadTimer();
      resolve(Buffer.concat(chunks, total));
    });

    response.on("error", (error) => {
      fail(error);
    });
  });
}

function discardResponseBody(response: IncomingMessage): void {
  if (!response.destroyed) {
    response.resume();
  }
}

/**
 * Fetches an HTTPS URL while protecting against SSRF.
 *
 * @param url - Absolute HTTPS URL to download.
 * @param options.maxBytes - Maximum response size in bytes. Must be a finite
 *   positive integer; `NaN`, `Infinity`, `0`, or negative values are rejected
 *   so they cannot bypass the size checks performed against Content-Length and
 *   the streamed body.
 */
export async function fetchPublicHttpsUrlToBuffer(
  url: string,
  {
    maxBytes,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    connectTimeoutMs,
    readTimeoutMs,
  }: {
    maxBytes: number;
    maxRedirects?: number;
    connectTimeoutMs?: number;
    readTimeoutMs?: number;
  },
): Promise<PublicHttpsDownload> {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("maxBytes must be a finite positive integer.");
  }

  let current = new URL(url);

  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    if (current.protocol !== "https:") {
      throw new Error("URL must use HTTPS.");
    }

    if (current.username || current.password) {
      throw new Error("URL must not contain embedded credentials.");
    }

    if (!isPublicHostnameLiteral(current.hostname)) {
      throw new Error("URL must point to a public host.");
    }

    const resolvedAddress = await resolvePublicHostname(current.hostname);
    const response = await requestResolvedHttpsUrl(current, resolvedAddress, {
      connectTimeoutMs,
      readTimeoutMs,
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = getHeaderValue(response.headers, "location");
      response.clearReadTimer();
      discardResponseBody(response.body);
      if (!location) {
        throw new Error("Redirect response was missing a Location header.");
      }

      current = new URL(location, current);
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      response.clearReadTimer();
      discardResponseBody(response.body);
      throw new Error(`URL could not be downloaded (HTTP ${response.status}).`);
    }

    const contentLengthHeader = getHeaderValue(
      response.headers,
      "content-length",
    );
    const contentLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : NaN;
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      response.clearReadTimer();
      response.body.destroy();
      throw new Error("URL response exceeds the maximum allowed size.");
    }

    const buffer = await readResponseBuffer(
      response.body,
      maxBytes,
      response.clearReadTimer,
      response.refreshReadTimer,
    );
    return {
      buffer,
      contentType: getHeaderValue(response.headers, "content-type"),
      finalUrl: current,
      headers: response.headers,
    };
  }

  throw new Error("URL followed too many redirects.");
}
