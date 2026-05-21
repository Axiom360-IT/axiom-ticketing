// MIME allowlist + filename sanitization for the attachments pipeline.
//
// Anything outside the allowlist is rejected at upload time — we never
// hand out a presigned URL for a `.exe`. Magic-byte verification
// (lib/storage/magic-bytes.ts) is the second line of defense after the
// browser's declared type, in case a client lies.

// Absolute hard cap, mirroring the CHECK constraint on
// `attachments.size_bytes` (10 MiB). The runtime per-file cap can be
// lowered below this via the `file_upload.max_size_bytes` setting —
// see `lib/storage/limits.ts:getAttachmentLimits`. Raising past this
// requires a DB migration.
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB per ARCHITECTURE §11
export const DEFAULT_MAX_FILES_PER_MESSAGE = 5;

const ALLOWED_MIME_TYPES = new Set<string>([
  // Images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  // Documents
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Logs / archives commonly attached on tickets
  "application/zip",
  "application/x-zip-compressed",
]);

export function isAllowedMimeType(mime: string | null | undefined): boolean {
  return typeof mime === "string" && ALLOWED_MIME_TYPES.has(mime.toLowerCase());
}

// MIME types that browsers happily render inline (HTML, SVG, PDFs in some
// browsers). Serving these inline from our domain creates an XSS surface
// even though we trust the magic bytes — so we always force download.
const FORCE_DOWNLOAD_MIME = new Set<string>([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
]);

export function downloadDispositionFor(
  mime: string,
): "inline" | "attachment" {
  return FORCE_DOWNLOAD_MIME.has(mime.toLowerCase()) ? "attachment" : "inline";
}

// Sanitize a user-provided filename:
// - strip any path components (foo/bar.png → bar.png, ..\evil → evil)
// - keep only ASCII alphanumerics, dot, underscore, hyphen
// - collapse runs of "." so attackers can't smuggle ".exe.png"
// - cap length at 80 chars (preserve extension)
// - never returns empty — falls back to "file"
const REPLACE_CHARS = /[^A-Za-z0-9._-]+/g;
const COLLAPSE_DOTS = /\.{2,}/g;
const STRIP_LEADING_DOT = /^\.+/;

export function sanitizeFilename(input: string): string {
  if (!input) return "file";

  // Drop any path components first (handles both forward and back slashes).
  const base = input.replace(/^.*[\\/]/, "");

  let cleaned = base
    .normalize("NFKD")
    .replace(REPLACE_CHARS, "_")
    .replace(COLLAPSE_DOTS, ".")
    .replace(STRIP_LEADING_DOT, "");

  if (!cleaned) return "file";

  // Truncate to 80 chars while preserving the extension.
  if (cleaned.length > 80) {
    const dot = cleaned.lastIndexOf(".");
    if (dot > 0 && cleaned.length - dot <= 10) {
      const ext = cleaned.slice(dot);
      cleaned = cleaned.slice(0, 80 - ext.length) + ext;
    } else {
      cleaned = cleaned.slice(0, 80);
    }
  }

  return cleaned;
}
