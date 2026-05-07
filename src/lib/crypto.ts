import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { CipherGCM, DecipherGCM } from "node:crypto";

// Envelope encryption for sensitive DB columns (per ARCHITECTURE §5.13).
//
// Wire format (base64-encoded): [12-byte IV][16-byte auth tag][ciphertext]
// Algorithm: AES-256-GCM
// Key: 32 random bytes from process.env.DATA_ENCRYPTION_KEY (base64-encoded)
//
// Encrypted columns (MVP): two_factor.secret_encrypted, two_factor.backup_codes_encrypted
// Any future column holding a third-party API key, OAuth token, or other secret
// MUST use this helper. Code review enforces.

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits, GCM-recommended
const TAG_LENGTH = 16; // 128 bits

function getKey(): Buffer {
  const key = process.env.DATA_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("DATA_ENCRYPTION_KEY is not set");
  }
  const buf = Buffer.from(key, "base64");
  if (buf.length !== KEY_LENGTH) {
    throw new Error(
      `DATA_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes; got ${buf.length}`,
    );
  }
  return buf;
}

/**
 * Encrypts a UTF-8 string using AES-256-GCM with a random IV.
 * The same plaintext encrypts to a different ciphertext on each call.
 *
 * @param plaintext - the value to encrypt
 * @returns base64-encoded `[IV][tag][ciphertext]`
 */
export function encryptField(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv) as CipherGCM;

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/**
 * Decrypts a value produced by `encryptField`.
 * Throws if the ciphertext was tampered with, the key is wrong, or the format is invalid.
 *
 * @param encrypted - base64-encoded `[IV][tag][ciphertext]`
 * @returns the original UTF-8 plaintext
 */
export function decryptField(encrypted: string): string {
  const key = getKey();
  const payload = Buffer.from(encrypted, "base64");

  if (payload.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("ciphertext is too short to be valid");
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv) as DecipherGCM;
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
