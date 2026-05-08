// Re-exports every Inngest function so the API route handler can register them
// in one place. Functions land here as modules ship:
//   - auto-close-resolved-tickets (M3 Phase C) — DONE
//   - process-inbound-email (M4) — DONE
//   - scan-attachment (M5 wiring; ClamAV scanner lands in M18)
//   - sla-monitor (M9) — DONE
//   - dispatch-notification + send-email/send-sms/send-in-app (M11)
//   - retention-* / cleanup-* (M21)

import { autoCloseResolvedTickets } from "./auto-close-resolved";
import { invalidateSettingsCache } from "./invalidate-settings-cache";
import { processInboundEmail } from "./process-inbound-email";
import { scanAttachment } from "./scan-attachment";
import { slaMonitor } from "./sla-monitor";

export const functions = [
  autoCloseResolvedTickets,
  processInboundEmail,
  scanAttachment,
  invalidateSettingsCache,
  slaMonitor,
];
