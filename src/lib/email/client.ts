import { Resend } from "resend";

if (!process.env.RESEND_API_KEY) {
  // Don't throw at module load (Resend is needed only when sending) but
  // do warn — production deployments must set this.
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[resend] RESEND_API_KEY is not set in production. Outbound email will fail.",
    );
  }
}

export const resend = new Resend(process.env.RESEND_API_KEY ?? "missing-key");
