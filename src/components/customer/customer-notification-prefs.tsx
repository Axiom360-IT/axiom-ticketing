"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  type NotificationPrefRow,
  updateNotificationPreference,
} from "@/app/actions/profile";
import { CUSTOMER_EVENT_TYPES } from "@/lib/notifications/audience";

// Customer-facing notification events come from the shared role matrix
// (src/lib/notifications/audience.ts) so the grid, the write-validation set,
// and the dispatch sites can never drift apart (req 6.4). The assignment row
// is `ticket.assigned_customer` — the customer-worded event — NOT the
// technician's `ticket.assigned` ("assigned to you"), which previously leaked
// into the customer's grid (req 6.1).
const CUSTOMER_EVENTS = CUSTOMER_EVENT_TYPES;

type Props = {
  initial: NotificationPrefRow[];
};

export function CustomerNotificationPrefs({ initial }: Props) {
  const t = useTranslations("portal.profile.notifications");
  const [pending, startTransition] = useTransition();

  const byEvent = new Map(initial.map((r) => [r.eventType, r] as const));

  function toggle(
    eventType: string,
    channel: "email" | "sms",
    next: boolean,
  ) {
    startTransition(async () => {
      await updateNotificationPreference({ eventType, channel, enabled: next });
    });
  }

  return (
    <table className="w-full max-w-2xl text-sm">
      <thead>
        <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
          <th className="py-2 pr-2 sm:pr-4 font-medium">{t("title")}</th>
          <th className="py-2 px-2 sm:px-4 font-medium text-center w-16 sm:w-auto">
            {t("emailColumn")}
          </th>
          <th className="py-2 pl-2 sm:pl-4 font-medium text-center w-16 sm:w-auto">
            {t("smsColumn")}
          </th>
        </tr>
      </thead>
      <tbody>
        {CUSTOMER_EVENTS.map((eventType) => {
          const row = byEvent.get(eventType);
          const email = row?.emailEnabled ?? true;
          const sms = row?.smsEnabled ?? true;
          return (
            <tr
              key={eventType}
              className="border-b border-zinc-200 dark:border-zinc-800"
            >
              <td className="py-2 pr-2 sm:pr-4 text-zinc-800 dark:text-zinc-200">
                {t(
                  `events.${eventType.replace(/\./g, "__")}` as `events.${string}`,
                )}
              </td>
              {/* Wrap the input in a label that fills the cell so the
                  whole 44×44 area is the tap target on mobile. */}
              <CheckCell
                checked={email}
                disabled={pending}
                onChange={(v) => toggle(eventType, "email", v)}
                ariaLabel={t("emailColumn")}
              />
              <CheckCell
                checked={sms}
                disabled={pending}
                onChange={(v) => toggle(eventType, "sms", v)}
                ariaLabel={t("smsColumn")}
              />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CheckCell({
  checked,
  disabled,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <td className="px-1 sm:px-4">
      <label className="flex items-center justify-center min-h-[44px] cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={ariaLabel}
          className="size-5 accent-blue-600 cursor-pointer"
        />
      </label>
    </td>
  );
}
