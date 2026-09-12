/**
 * Thrown when Resend REJECTS a send (as opposed to a network failure).
 * Carries Resend's own error name (`daily_quota_exceeded`, `invalid_api_key`,
 * `validation_error`, …) so callers can tell a permanent configuration/quota
 * problem from something worth retrying, without parsing the message text.
 *
 * Deliberately its own leaf module with no imports: `send.tsx` pulls in the
 * whole template stack (and `server-only`), which anything merely classifying
 * an error — including unit tests — has no business loading.
 */
export class EmailSendError extends Error {
  readonly resendErrorName: string | undefined;
  constructor(message: string, resendErrorName?: string) {
    super(message);
    this.name = "EmailSendError";
    this.resendErrorName = resendErrorName;
  }
}
