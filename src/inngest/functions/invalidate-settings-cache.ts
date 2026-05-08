import { eventType } from "inngest";
import { invalidateSetting } from "@/lib/settings";
import { inngest } from "../client";

// Inngest fans out the `setting/updated` event to every running app
// instance. Each instance drops the changed key from its in-memory
// settings cache (per ARCHITECTURE §12). Single-instance dev still
// benefits — `updateSetting` always emits the event so writes propagate
// even if a new instance later spins up.

type EventData = { key: string };

export const invalidateSettingsCache = inngest.createFunction(
  {
    id: "invalidate-settings-cache",
    triggers: eventType("setting/updated"),
  },
  async ({ event }) => {
    const { key } = event.data as EventData;
    invalidateSetting(key);
    return { invalidated: key };
  },
);
