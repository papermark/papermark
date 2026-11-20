import crypto from "crypto";

/**
 * Redis cache key for a team's fetched Slack channel list.
 */
export const slackChannelsCacheKey = (teamId: string) =>
  `slack:channels:${teamId}`;

/**
 * Derives a 32-byte encryption key from the environment variable using SHA-256
 * @param keyMaterial - The raw key material from environment
 * @returns 32-byte Buffer for AES-256
 */
function deriveKey(keyMaterial: string): Buffer {
  return crypto.createHash("sha256").update(keyMaterial, "utf8").digest();
}

/**
 * Checks if a token is already encrypted by detecting the encrypted format
 * @param token - Token to check
 * @returns true if already encrypted
 */
function isTokenEncrypted(token: string): boolean {
  if (!token) return false;

  // Check for encrypted format (iv:encrypted:authTag - 3 parts, all hex)
  const parts = token.split(":");
  if (parts.length === 3) {
    const [iv, encrypted, authTag] = parts;
    // New format: 24-char hex IV (12 bytes), hex encrypted data, 32-char hex authTag (16 bytes)
    return (
      /^[0-9a-f]{24}$/.test(iv) &&
      /^[0-9a-f]+$/.test(encrypted) &&
      /^[0-9a-f]{32}$/.test(authTag)
    );
  }

  return false;
}

export function encryptSlackToken(token: string): string {
  if (!token) return "";

  // Avoid double-encryption with improved detection
  if (isTokenEncrypted(token)) {
    return token;
  }

  const encryptionKey = process.env.NEXT_PRIVATE_SLACK_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error(
      "NEXT_PRIVATE_SLACK_ENCRYPTION_KEY environment variable is required for token encryption",
    );
  }

  // Derive key using raw SHA-256 digest Buffer
  const key = deriveKey(encryptionKey);

  // Use 12-byte IV for GCM (recommended size)
  const iv = crypto.randomBytes(12);

  // Create AES-256-GCM cipher
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  // Encrypt the token
  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");

  // Get authentication tag
  const authTag = cipher.getAuthTag();

  // Format: iv:encrypted:authTag (all hex-encoded)
  return `${iv.toString("hex")}:${encrypted}:${authTag.toString("hex")}`;
}

export function decryptSlackToken(encryptedToken: string): string {
  if (!encryptedToken) return "";

  const encryptionKey = process.env.NEXT_PRIVATE_SLACK_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error(
      "NEXT_PRIVATE_SLACK_ENCRYPTION_KEY environment variable is required for token decryption",
    );
  }

  // Derive key using raw SHA-256 digest Buffer
  const key = deriveKey(encryptionKey);

  const parts = encryptedToken.split(":");

  // Handle new GCM format: iv:encrypted:authTag
  if (parts.length === 3) {
    try {
      const [ivHex, encryptedHex, authTagHex] = parts;

      // Parse components
      const iv = Buffer.from(ivHex, "hex");
      const encrypted = Buffer.from(encryptedHex, "hex");
      const authTag = Buffer.from(authTagHex, "hex");

      // Validate sizes
      if (iv.length !== 12) {
        throw new Error("Invalid IV length for GCM");
      }
      if (authTag.length !== 16) {
        throw new Error("Invalid auth tag length for GCM");
      }

      // Create decipher and set auth tag
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);

      // Decrypt
      let decrypted = decipher.update(encrypted, undefined, "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      // Surface authentication failures as decryption errors
      throw new Error(
        `Token decryption failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  // If not in expected format, return as-is (might be plaintext)
  return encryptedToken;
}
