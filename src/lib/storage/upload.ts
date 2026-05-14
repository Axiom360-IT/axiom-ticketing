import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Bucket, r2Client, r2EnvPrefix } from "./client";

const PRESIGN_TTL_SECONDS = 5 * 60;

/**
 * Upload bytes directly to R2 from server context (used for inbound email
 * attachments, where we already have the bytes in memory after mailparser
 * decoded them, so presigning is unnecessary).
 */
export async function uploadObject(
  storageKey: string,
  body: Uint8Array,
  mimeType: string,
): Promise<void> {
  await r2Client().send(
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: storageKey,
      Body: body,
      ContentType: mimeType,
      ContentLength: body.byteLength,
    }),
  );
}

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
 * Build the storage key for a user's profile avatar. Timestamp suffix
 * means uploading a new avatar produces a new key — the old object is
 * removed by `removeAvatar`, but if cleanup ever fails, browsers won't
 * serve a cached version of the wrong image.
 *   <env>/avatars/<userId>/<timestamp>.<ext>
 */
export function avatarStorageKey(userId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 5);
  return `${r2EnvPrefix()}/avatars/${userId}/${Date.now()}.${safeExt}`;
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
