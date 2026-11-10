"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  type OrgNotificationSettingRow,
  setOrganizationNotificationSettings,
} from "@/app/actions/organizations";
import { Button } from "@/components/ui/button";
import { ORG_MUTABLE_EVENTS } from "@/lib/notifications/audience";

// Per-organization notification switches. A ticked box means "this
// organization allows it"; everything is ticked by default and only unticked
// boxes are stored. The organization switch can only silence a notification —
// each person's own preferences (profile) still apply on top of it.

type Channels = { email: boolean; sms: boolean; inApp: boolean };
const ALL_ON: Channels = { email: true, sms: true, inApp: true };
const ALL_OFF: Channels = { email: false, sms: false, inApp: false };

type Props = {
  organizationId: string;
  initial: OrgNotificationSettingRow[];
  canEdit: boolean;
};

export function OrgNotificationSettings({
  organizationId,
  initial,
  canEdit,
}: Props) {
  const t = useTranslations("organizations.notifications");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, Channels>>(() =>
    Object.fromEntries(
      initial.map((r) => [
        r.eventType,
        { email: r.emailEnabled, sms: r.smsEnabled, inApp: r.inAppEnabled },
      ]),
    ),
  );

  const channelsFor = (eventType: string): Channels =>
    state[eventType] ?? ALL_ON;

  function save(changes: Record<string, Channels>) {
    const previous = state;
    setError(null);
    setState({ ...state, ...changes });
    startTransition(async () => {
      const res = await setOrganizationNotificationSettings({
        organizationId,
        settings: Object.entries(changes).map(([eventType, c]) => ({
          eventType,
          emailEnabled: c.email,
          smsEnabled: c.sms,
          inAppEnabled: c.inApp,
        })),
      });
      if (!res.ok) {
        setState(previous);
        setError(res.error);
      }
    });
  }

  function toggle(eventType: string, channel: keyof Channels, next: boolean) {
    save({ [eventType]: { ...channelsFor(eventType), [channel]: next } });
  }

  function setGroup(events: readonly string[], value: Channels) {
    save(Object.fromEntries(events.map((e) => [e, value])));
  }

  const groups = [
    { key: "customer", events: ORG_MUTABLE_EVENTS.customer },
    { key: "staff", events: ORG_MUTABLE_EVENTS.staff },
  ] as const;

  return (
    <div className="space-y-8">
      {groups.map(({ key, events }) => {
        const allOff = events.every((e) => {
          const c = channelsFor(e);
          return !c.email && !c.sms && !c.inApp;
        });
        return (
          <section key={key} className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-medium">{t(`${key}Heading`)}</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t(`${key}Hint`)}
                </p>
              </div>
              {canEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => setGroup(events, allOff ? ALL_ON : ALL_OFF)}
                >
                  {allOff ? t("turnAllOn") : t("turnAllOff")}
                </Button>
              ) : null}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th className="py-2 pr-2 font-medium sm:pr-4">
                      {t("eventColumn")}
                    </th>
                    <th className="w-16 px-2 py-2 text-center font-medium sm:w-auto sm:px-4">
                      {t("emailColumn")}
                    </th>
                    <th className="w-16 px-2 py-2 text-center font-medium sm:w-auto sm:px-4">
                      {t("smsColumn")}
                    </th>
                    <th className="w-16 px-2 py-2 text-center font-medium sm:w-auto sm:px-4">
                      {t("inAppColumn")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((eventType) => {
                    const c = channelsFor(eventType);
                    return (
                      <tr
                        key={eventType}
                        className="border-b border-zinc-200 dark:border-zinc-800"
                      >
                        <td className="py-2 pr-2 text-zinc-800 dark:text-zinc-200 sm:pr-4">
                          {t(
                            `events.${eventType.replace(/\./g, "__")}` as `events.${string}`,
                          )}
                        </td>
                        <CheckCell
                          checked={c.email}
                          disabled={pending || !canEdit}
                          onChange={(v) => toggle(eventType, "email", v)}
                          ariaLabel={t("emailColumn")}
                        />
                        <CheckCell
                          checked={c.sms}
                          disabled={pending || !canEdit}
                          onChange={(v) => toggle(eventType, "sms", v)}
                          ariaLabel={t("smsColumn")}
                        />
                        <CheckCell
                          checked={c.inApp}
                          disabled={pending || !canEdit}
                          onChange={(v) => toggle(eventType, "inApp", v)}
                          ariaLabel={t("inAppColumn")}
                        />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
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
      <label className="flex min-h-[44px] cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={ariaLabel}
          className="h-4 w-4"
        />
      </label>
    </td>
  );
}
