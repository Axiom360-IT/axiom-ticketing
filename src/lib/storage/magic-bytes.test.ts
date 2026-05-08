import { describe, expect, it } from "vitest";
import { matchesMagicBytes } from "./magic-bytes";

function bytes(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}

describe("matchesMagicBytes — accepts well-formed files", () => {
  it("PNG signature", () => {
    expect(
      matchesMagicBytes(
        "image/png",
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00),
      ),
    ).toBe(true);
  });

  it("JPEG signature", () => {
    expect(
      matchesMagicBytes("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0, 0x00)),
    ).toBe(true);
  });

  it("GIF87a", () => {
    expect(
      matchesMagicBytes(
        "image/gif",
        bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61),
      ),
    ).toBe(true);
  });

  it("GIF89a", () => {
    expect(
      matchesMagicBytes(
        "image/gif",
        bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61),
      ),
    ).toBe(true);
  });

  it("WebP requires both RIFF prefix and WEBP at offset 8", () => {
    // RIFF<size>WEBP
    expect(
      matchesMagicBytes(
        "image/webp",
        bytes(
          0x52, 0x49, 0x46, 0x46,
          0x00, 0x00, 0x00, 0x00,
          0x57, 0x45, 0x42, 0x50,
        ),
      ),
    ).toBe(true);
  });

  it("PDF signature", () => {
    expect(
      matchesMagicBytes("application/pdf", bytes(0x25, 0x50, 0x44, 0x46, 0x2d)),
    ).toBe(true);
  });

  it("ZIP / docx / xlsx / pptx all share the PK\\x03\\x04 prefix", () => {
    const zip = bytes(0x50, 0x4b, 0x03, 0x04);
    expect(matchesMagicBytes("application/zip", zip)).toBe(true);
    expect(
      matchesMagicBytes(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        zip,
      ),
    ).toBe(true);
    expect(
      matchesMagicBytes(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        zip,
      ),
    ).toBe(true);
  });

  it("legacy Office (msword/xls/ppt) accepts the OLE2 signature", () => {
    const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    expect(matchesMagicBytes("application/msword", ole)).toBe(true);
    expect(matchesMagicBytes("application/vnd.ms-excel", ole)).toBe(true);
  });

  it("text/plain skips magic-byte verification", () => {
    expect(matchesMagicBytes("text/plain", bytes(0x00, 0x00))).toBe(true);
  });
});

describe("matchesMagicBytes — rejects mismatched files", () => {
  it("rejects an exe-renamed-png", () => {
    // "MZ" — Windows PE header — declared as PNG.
    expect(
      matchesMagicBytes("image/png", bytes(0x4d, 0x5a, 0x90, 0x00)),
    ).toBe(false);
  });

  it("rejects PDF bytes declared as PNG", () => {
    expect(
      matchesMagicBytes("image/png", bytes(0x25, 0x50, 0x44, 0x46)),
    ).toBe(false);
  });

  it("rejects WebP if RIFF prefix matches but WEBP marker doesn't", () => {
    expect(
      matchesMagicBytes(
        "image/webp",
        bytes(
          0x52, 0x49, 0x46, 0x46,
          0x00, 0x00, 0x00, 0x00,
          0x41, 0x56, 0x49, 0x20, // AVI instead of WEBP
        ),
      ),
    ).toBe(false);
  });

  it("rejects unknown MIME types entirely", () => {
    expect(
      matchesMagicBytes("application/x-evil", bytes(0x4d, 0x5a)),
    ).toBe(false);
  });

  it("rejects a buffer that's too short to contain the signature", () => {
    expect(matchesMagicBytes("image/png", bytes(0x89, 0x50))).toBe(false);
  });

  it("rejects mp4 bytes (signature at offset 4) when offset is wrong", () => {
    // ftyp starts at offset 0 instead of 4 — should fail.
    expect(
      matchesMagicBytes(
        "video/mp4",
        bytes(0x66, 0x74, 0x79, 0x70, 0x00, 0x00, 0x00, 0x00),
      ),
    ).toBe(false);
  });
});
