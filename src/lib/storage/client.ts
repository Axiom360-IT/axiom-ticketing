import { S3Client } from "@aws-sdk/client-s3";

// Cloudflare R2 over the S3-compatible API. Per ARCHITECTURE §11.1.
//
// Credentials and bucket name come from env. We keep a single shared
// client (S3Client is safe to reuse — it's a thin wrapper over fetch).
//
// Tests do NOT import this module — they import the lower-level helpers
// (magic-bytes, mime, sanitize) which don't depend on env or network.

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let cached: S3Client | null = null;

export function r2Client(): S3Client {
  if (cached) return cached;
  cached = new S3Client({
    region: "auto",
    endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return cached;
}

export function r2Bucket(): string {
  return requireEnv("R2_BUCKET");
}

/** App environment string used as the top-level prefix of every storage key. */
export function r2EnvPrefix(): string {
  return process.env.R2_ENV_PREFIX ?? process.env.NODE_ENV ?? "development";
}
