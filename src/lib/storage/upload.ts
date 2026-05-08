import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Bucket, r2Client, r2EnvPrefix } from "./client";

const PRESIGN_TTL_SECONDS = 5 * 60;

/**
 * Build the storage key for an attachment. Per ARCHITECTURE §11.2:
 *   <env>/<ticketId>/<attachmentId>/<sanitizedFilename>
 *
 * Predictable but unguessable — both UUIDs in the path are required to
 * read the object, and the bucket itself is deny-by-default.
 */
export function attachmentStorageKey(
  ticketId: string,
  attachmentId: string,
  sanitizedFilename: string,
): string {
  return `${r2EnvPrefix()}/${ticketId}/${attachmentId}/${sanitizedFilename}`;
}

/**
 * Generate a presigned PUT URL the client can upload to directly.
 * The Server Action that creates the attachment row controls all the
 * inputs to this — there is no caller-supplied content type from the
 * client beyond what was already validated against the MIME allowlist.
 */
export async function presignUploadUrl(
  storageKey: string,
  mimeType: string,
  sizeBytes: number,
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: r2Bucket(),
    Key: storageKey,
    ContentType: mimeType,
    ContentLength: sizeBytes,
  });
  return getSignedUrl(r2Client(), cmd, { expiresIn: PRESIGN_TTL_SECONDS });
}
