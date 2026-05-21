// Re-exports every Inngest function so the API route handler can register them
// in one place. Functions land here as modules ship:
//   - auto-close-resolved-tickets (M3 Phase C) — DONE
//   - process-inbound-email (M4) — DONE
//   - scan-attachment (M5 wiring; ClamAV scanner lands in M18)
//   - sla-monitor (M9) — DONE
//   - dispatch-notification + send-email/send-sms/send-in-app (M11) — DONE
//   - cleanup-old-notifications (M11) — DONE
//   - retention-* / other cleanup-* (M21)

import { autoCloseResolvedTickets } from "./auto-close-resolved";
import { cleanupOldNotifications } from "./cleanup-old-notifications";
import { cleanupStaleDrafts } from "./cleanup-stale-drafts";
import { cleanupStaleLockouts } from "./cleanup-stale-lockouts";
import { dispatchNotification } from "./dispatch-notification";
import { processInboundEmail } from "./process-inbound-email";
import { scanAttachment } from "./scan-attachment";
import { sendEmailNotification } from "./send-email-notification";
import { sendInAppNotification } from "./send-in-app-notification";
import { sendSmsNotification } from "./send-sms-notification";
import { slaMonitor } from "./sla-monitor";

export const functions = [
  autoCloseResolvedTickets,
  processInboundEmail,
  scanAttachment,
  slaMonitor,
  dispatchNotification,
  sendEmailNotification,
  sendSmsNotification,
  sendInAppNotification,
  cleanupOldNotifications,
  cleanupStaleDrafts,
  cleanupStaleLockouts,
];
