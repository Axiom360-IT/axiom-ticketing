// Magic-byte signatures per ARCHITECTURE §11.6.
//
// The contract: given the FIRST N bytes of an upload (we use 16 — enough
// for every signature below) and the declared MIME from the client, return
// true iff the bytes match what that MIME's container should look like.
// This catches `evil.exe` renamed to `cute.png`.

type Signature = {
  /** Byte sequence to match. */
  bytes: number[];
  /** Offset into the file where the sequence should appear. Default 0. */
  offset?: number;
};

const SIGNATURES: Record<string, Signature[]> = {
  "image/png": [
    { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  ],
  "image/jpeg": [{ bytes: [0xff, 0xd8, 0xff] }],
  "image/gif": [
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
  ],
  "image/webp": [
    // RIFF....WEBP
    { bytes: [0x52, 0x49, 0x46, 0x46] },
    { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  ],
  "application/pdf": [{ bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  "video/mp4": [
    // ftyp at offset 4
    { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  ],
  "application/zip": [
    { bytes: [0x50, 0x4b, 0x03, 0x04] },
    // Empty / spanned archives
    { bytes: [0x50, 0x4b, 0x05, 0x06] },
    { bytes: [0x50, 0x4b, 0x07, 0x08] },
  ],
  "application/x-zip-compressed": [{ bytes: [0x50, 0x4b, 0x03, 0x04] }],
  // Office Open XML files (.docx, .xlsx, .pptx) are zip containers.
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    { bytes: [0x50, 0x4b, 0x03, 0x04] },
  ],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    { bytes: [0x50, 0x4b, 0x03, 0x04] },
  ],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    { bytes: [0x50, 0x4b, 0x03, 0x04] },
  ],
  // Legacy Office uses the OLE2 compound document signature.
  "application/msword": [
    { bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  ],
  "application/vnd.ms-excel": [
    { bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  ],
  "application/vnd.ms-powerpoint": [
    { bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  ],
};

// MIME types that don't have a reliable magic byte (plain text, csv).
// We accept them without bytewise verification; the MIME allowlist + size
// limit + filename sanitizer + ClamAV stage are the defense for these.
const NO_MAGIC_REQUIRED = new Set<string>([
  "text/plain",
  "text/csv",
]);

function matchesAt(buf: Uint8Array, sig: Signature): boolean {
  const offset = sig.offset ?? 0;
  if (buf.length < offset + sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    if (buf[offset + i] !== sig.bytes[i]) return false;
  }
  return true;
}

/**
 * Check whether the leading bytes of a file match the declared MIME's
 * known signatures. For container types with multiple required parts
 * (e.g. WebP), all parts must match.
 */
export function matchesMagicBytes(
  declaredMime: string,
  bytes: Uint8Array,
): boolean {
  const mime = declaredMime.toLowerCase();
  if (NO_MAGIC_REQUIRED.has(mime)) return true;

  const sigs = SIGNATURES[mime];
  if (!sigs || sigs.length === 0) return false;

  // image/webp: requires both RIFF prefix AND WEBP at offset 8.
  if (mime === "image/webp") {
    return sigs.every((s) => matchesAt(bytes, s));
  }

  // All other types: any signature in the list matches.
  return sigs.some((s) => matchesAt(bytes, s));
}

/** Number of leading bytes the validator needs to inspect. */
export const MAGIC_BYTES_PREFIX_SIZE = 16;
