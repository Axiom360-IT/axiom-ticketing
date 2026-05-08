import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Bucket, r2Client } from "./client";
import { MAGIC_BYTES_PREFIX_SIZE } from "./magic-bytes";

const PRESIGN_TTL_SECONDS = 5 * 60;

/**
 * Generate a short-lived signed GET URL. `disposition: "attachment"` adds
 * a `Content-Disposition: attachment; filename="…"` response header so
 * risky types (PDFs, archives) trigger a download instead of being
 * rendered inline by the browser.
 */
export async function getSignedDownloadUrl(
  storageKey: string,
  options: {
    disposition?: "inline" | "attachment";
    filename?: string;
  } = {},
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: r2Bucket(),
    Key: storageKey,
    ResponseContentDisposition:
      options.disposition === "attachment"
        ? `attachment; filename="${options.filename ?? "download"}"`
        : undefined,
  });
  return getSignedUrl(r2Client(), cmd, { expiresIn: PRESIGN_TTL_SECONDS });
}

/**
 * Read just the leading bytes of an object — used by `confirmUpload` to
 * verify the file's magic bytes match the declared MIME without pulling
 * the whole file. R2 supports HTTP Range exactly like S3.
 */
export async function fetchObjectPrefix(
  storageKey: string,
  bytes: number = MAGIC_BYTES_PREFIX_SIZE,
): Promise<Uint8Array> {
  const cmd = new GetObjectCommand({
    Bucket: r2Bucket(),
    Key: storageKey,
    Range: `bytes=0-${bytes - 1}`,
  });
  const out = await r2Client().send(cmd);
  if (!out.Body) {
    throw new Error("R2 returned no body for prefix read");
  }
  // SDK Body is a stream; transformToByteArray collects it.
  // Available in @aws-sdk/types via the SdkStreamMixin.
  return await out.Body.transformToByteArray();
}

/** Verify an object exists in R2 (used post-upload before confirming). */
export async function objectExists(storageKey: string): Promise<boolean> {
  try {
    await r2Client().send(
      new HeadObjectCommand({ Bucket: r2Bucket(), Key: storageKey }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Delete an object — used when magic-byte verification fails. */
export async function deleteObject(storageKey: string): Promise<void> {
  await r2Client().send(
    new DeleteObjectCommand({ Bucket: r2Bucket(), Key: storageKey }),
  );
}
