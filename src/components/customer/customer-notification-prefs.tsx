"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  type NotificationPrefRow,
  updateNotificationPreference,
} from "@/app/actions/profile";

// Customer-facing notification events. Each one has a per-user pref row
// in `notification_preferences` (email + SMS toggle). The previous list
// had `ticket.customer_replied` here, but that event is fired to AGENTS
// when the CUSTOMER replies — wrong recipient for the customer's
// "when my ticket gets a reply" intent. Replaced with
// `ticket.agent_replied` which fires to the customer when an agent
// posts a reply. Existing pref rows under the old event key will fall
// back to the schema defaults (email on, SMS on) since no UI exposes
// them anymore — acceptable for a tool whose users are still onboarding.
const CUSTOMER_EVENTS = [
  "ticket.assigned",
  "ticket.agent_replied",
  "ticket.resolved",
  "ticket.reopened",
  "ticket.closed",
] as const;

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
