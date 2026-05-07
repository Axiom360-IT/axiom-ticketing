import { beforeAll, describe, expect, it } from "vitest";
import { decryptField, encryptField } from "./crypto";

// Hermetic test key (32 zero bytes, base64-encoded). Tests never depend on .env.local.
const TEST_KEY = Buffer.alloc(32, 0).toString("base64");

beforeAll(() => {
  process.env.DATA_ENCRYPTION_KEY = TEST_KEY;
});

describe("encryptField / decryptField", () => {
  it("roundtrips a simple string", () => {
    const plain = "hello world";
    expect(decryptField(encryptField(plain))).toBe(plain);
  });

  it("roundtrips an empty string", () => {
    expect(decryptField(encryptField(""))).toBe("");
  });

  it("roundtrips unicode and emoji", () => {
    const plain = "こんにちは 🎉 emoji";
    expect(decryptField(encryptField(plain))).toBe(plain);
  });

  it("roundtrips long strings", () => {
    const plain = "x".repeat(10_000);
    expect(decryptField(encryptField(plain))).toBe(plain);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const a = encryptField("same input");
    const b = encryptField("same input");
    expect(a).not.toBe(b);
  });

  it("rejects tampered ciphertext", () => {
    const cipher = encryptField("secret");
    const buf = Buffer.from(cipher, "base64");
    // Flip a byte in the ciphertext portion (after IV + tag)
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString("base64");
    expect(() => decryptField(tampered)).toThrow();
  });

  it("rejects tampered auth tag", () => {
    const cipher = encryptField("secret");
    const buf = Buffer.from(cipher, "base64");
    // Flip a byte in the auth tag (bytes 12..28)
    buf[15] ^= 0xff;
    expect(() => decryptField(buf.toString("base64"))).toThrow();
  });

  it("rejects ciphertext that is too short", () => {
    expect(() => decryptField("AAAA")).toThrow(/too short/i);
  });

  it("throws when DATA_ENCRYPTION_KEY is missing", () => {
    const original = process.env.DATA_ENCRYPTION_KEY;
    delete process.env.DATA_ENCRYPTION_KEY;
    try {
      expect(() => encryptField("x")).toThrow(/DATA_ENCRYPTION_KEY/);
      expect(() => decryptField("x")).toThrow(/DATA_ENCRYPTION_KEY/);
    } finally {
      process.env.DATA_ENCRYPTION_KEY = original;
    }
  });

  it("throws when DATA_ENCRYPTION_KEY is the wrong length", () => {
    const original = process.env.DATA_ENCRYPTION_KEY;
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(16, 0).toString("base64"); // 16 bytes, not 32
    try {
      expect(() => encryptField("x")).toThrow(/32 bytes/);
    } finally {
      process.env.DATA_ENCRYPTION_KEY = original;
    }
  });

  it("decryption with a different key fails", () => {
    const cipher = encryptField("secret");
    const original = process.env.DATA_ENCRYPTION_KEY;
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64"); // different key
    try {
      expect(() => decryptField(cipher)).toThrow();
    } finally {
      process.env.DATA_ENCRYPTION_KEY = original;
    }
  });
});
