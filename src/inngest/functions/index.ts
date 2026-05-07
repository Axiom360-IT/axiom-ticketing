// Re-exports every Inngest function so the API route handler can register them
// in one place. Functions land here as modules ship:
//   - auto-close-resolved-tickets (M3 Phase C) — DONE
//   - process-inbound-email (M4)
//   - scan-attachment (M5 / M18)
//   - dispatch-notification + send-email/send-sms/send-in-app (M11)
//   - sla-monitor (M9)
//   - retention-* / cleanup-* (M21)

import { autoCloseResolvedTickets } from "./auto-close-resolved";

export const functions = [autoCloseResolvedTickets];
