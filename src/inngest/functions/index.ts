// Re-exports every Inngest function so the API route handler can register them
// in one place. Functions land here as modules ship:
//   - auto-close-resolved-tickets (M3 Phase C) — DONE
//   - process-inbound-email (M4) — DONE
//   - scan-attachment (M5 wiring; ClamAV scanner lands in M18)
//   - dispatch-notification + send-email/send-sms/send-in-app (M11)
//   - sla-monitor (M9)
//   - retention-* / cleanup-* (M21)

import { autoCloseResolvedTickets } from "./auto-close-resolved";
import { processInboundEmail } from "./process-inbound-email";
import { scanAttachment } from "./scan-attachment";

export const functions = [
  autoCloseResolvedTickets,
  processInboundEmail,
  scanAttachment,
];
