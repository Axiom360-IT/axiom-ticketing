"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type NotificationPrefRow,
  updateNotificationPreference,
} from "@/app/actions/profile";

type Props = {
  initial: NotificationPrefRow[];
};

export function PreferencesGrid({ initial }: Props) {
  const router = useRouter();
  const t = useTranslations("profile.preferences");
  const tEvents = useTranslations("profile.preferences.events");
  const [rows, setRows] = useState<NotificationPrefRow[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(eventType: string, channel: "email" | "sms", next: boolean) {
    // Optimistic flip; rollback on failure.
    setError(null);
    setRows((prev) =>
      prev.map((r) =>
        r.eventType === eventType
          ? channel === "email"
            ? { ...r, emailEnabled: next }
            : { ...r, smsEnabled: next }
          : r,
      ),
    );
    startTransition(async () => {
      const res = await updateNotificationPreference({
        eventType,
        channel,
        enabled: next,
      });
      if (!res.ok) {
        setError(res.error);
        // revert
        setRows((prev) =>
          prev.map((r) =>
            r.eventType === eventType
              ? channel === "email"
                ? { ...r, emailEnabled: !next }
                : { ...r, smsEnabled: !next }
              : r,
          ),
        );
        return;
      }
      router.refresh();
    });
  }

  type EventLabel = Parameters<typeof tEvents>[0];

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
              <th className="py-2 pr-4">{t("headerEvent")}</th>
              <th className="py-2 pr-4">{t("headerEmail")}</th>
              <th className="py-2 pr-4">{t("headerSms")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.eventType}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="py-2 pr-4">
                  {tEvents(r.eventType as EventLabel)}
                </td>
                <td className="py-2 pr-4">
                  <input
                    type="checkbox"
                    checked={r.emailEnabled}
                    onChange={(e) =>
                      toggle(r.eventType, "email", e.target.checked)
                    }
                    disabled={isPending}
                  />
                </td>
                <td className="py-2 pr-4">
                  <input
                    type="checkbox"
                    checked={r.smsEnabled}
                    onChange={(e) =>
                      toggle(r.eventType, "sms", e.target.checked)
                    }
                    disabled={isPending}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
