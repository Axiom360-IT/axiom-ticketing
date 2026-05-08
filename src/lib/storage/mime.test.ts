import { describe, expect, it } from "vitest";
import {
  downloadDispositionFor,
  isAllowedMimeType,
  MAX_FILE_BYTES,
  sanitizeFilename,
} from "./mime";

describe("isAllowedMimeType", () => {
  it("accepts common image and document types", () => {
    expect(isAllowedMimeType("image/png")).toBe(true);
    expect(isAllowedMimeType("image/jpeg")).toBe(true);
    expect(isAllowedMimeType("application/pdf")).toBe(true);
    expect(isAllowedMimeType("text/plain")).toBe(true);
    expect(
      isAllowedMimeType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
  });

  it("rejects executables and scripts", () => {
    expect(isAllowedMimeType("application/x-msdownload")).toBe(false);
    expect(isAllowedMimeType("application/x-sh")).toBe(false);
    expect(isAllowedMimeType("text/html")).toBe(false);
    expect(isAllowedMimeType("image/svg+xml")).toBe(false); // SVG = HTML embed
  });

  it("rejects null/undefined and case is normalized", () => {
    expect(isAllowedMimeType(null)).toBe(false);
    expect(isAllowedMimeType(undefined)).toBe(false);
    expect(isAllowedMimeType("IMAGE/PNG")).toBe(true);
  });
});

describe("downloadDispositionFor", () => {
  it("forces attachment for PDFs and zips", () => {
    expect(downloadDispositionFor("application/pdf")).toBe("attachment");
    expect(downloadDispositionFor("application/zip")).toBe("attachment");
  });
  it("inline for images", () => {
    expect(downloadDispositionFor("image/png")).toBe("inline");
    expect(downloadDispositionFor("image/jpeg")).toBe("inline");
  });
});

describe("sanitizeFilename", () => {
  it("strips path components", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\evil\\thing.exe")).toBe("thing.exe");
  });

  it("replaces unsafe characters with underscores", () => {
    expect(sanitizeFilename("re port (2026).pdf")).toBe("re_port_2026_.pdf");
  });

  it("collapses '..' so doubled extensions can't smuggle past UI checks", () => {
    expect(sanitizeFilename("photo..png")).toBe("photo.png");
    expect(sanitizeFilename("...evil.exe")).toBe("evil.exe");
  });

  it("falls back to 'file' on empty input", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("...")).toBe("file");
    expect(sanitizeFilename("/")).toBe("file");
  });

  it("truncates to 80 chars while preserving short extensions", () => {
    const long = "a".repeat(100) + ".png";
    const out = sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith(".png")).toBe(true);
  });

  it("does not preserve weird ultra-long extensions", () => {
    const long = "a".repeat(60) + "." + "b".repeat(60);
    const out = sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(80);
  });
});

describe("MAX_FILE_BYTES", () => {
  it("is 10 MiB per ARCHITECTURE", () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
  });
});
