import { getSetting } from "../settings";
import { DEFAULT_MAX_FILES_PER_MESSAGE, MAX_FILE_BYTES } from "./mime";

// Runtime resolver for the admin-configurable attachment limits.
//
// Both values are clamped to safe bounds so a malformed setting (or one
// somebody hand-edited in the DB) can't break uploads:
//   - `maxFileBytes` is clamped to [1, MAX_FILE_BYTES]. The hard cap
//     matches the CHECK constraint on `attachments.size_bytes`, so going
//     higher would just produce constraint errors at insert time anyway.
//   - `maxFilesPerMessage` is clamped to [1, 20]. Same as the zod
//     bound in `settings-registry.ts`.

export type AttachmentLimits = {
  maxFileBytes: number;
  maxFilesPerMessage: number;
};

export async function getAttachmentLimits(): Promise<AttachmentLimits> {
  const [rawBytes, rawCount] = await Promise.all([
    getSetting<number>("file_upload.max_size_bytes"),
    getSetting<number>("file_upload.max_files_per_message"),
  ]);

  const maxFileBytes = Math.min(
    MAX_FILE_BYTES,
    Math.max(1, Number.isFinite(rawBytes ?? 0) ? (rawBytes ?? MAX_FILE_BYTES) : MAX_FILE_BYTES),
  );

  const maxFilesPerMessage = Math.min(
    20,
    Math.max(
      1,
      Number.isInteger(rawCount)
        ? (rawCount as number)
        : DEFAULT_MAX_FILES_PER_MESSAGE,
    ),
  );

  return { maxFileBytes, maxFilesPerMessage };
}
