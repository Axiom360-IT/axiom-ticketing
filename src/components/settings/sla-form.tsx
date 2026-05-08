"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { updateSetting } from "@/app/actions/settings";
import { SaveRow } from "./save-button";

const PRIORITIES = ["critical", "high", "medium", "low"] as const;
type Priority = (typeof PRIORITIES)[number];

type Row = {
  responseMinutes: number;
  resolveMinutes: number;
  respectBusinessHours: boolean;
};

type Props = {
  initial: Record<Priority, Row>;
};

export function SlaTargetsForm({ initial }: Props) {
  const router = useRouter();
  const tPriority = useTranslations("tickets.priority");
  const tColumns = useTranslations("settings.sla.columns");
  const [rows, setRows] = useState<Record<Priority, Row>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function update(priority: Priority, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [priority]: { ...prev[priority], ...patch } }));
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      for (const p of PRIORITIES) {
        const r = rows[p];
        const writes: [string, unknown][] = [
          [`sla.${p}.response_minutes`, r.responseMinutes],
          [`sla.${p}.resolve_minutes`, r.resolveMinutes],
          [`sla.${p}.respect_business_hours`, r.respectBusinessHours],
        ];
        for (const [k, v] of writes) {
          const res = await updateSetting(k, v);
          if (!res.ok) {
            setError(`${k}: ${res.error}`);
            return;
          }
        }
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
              <th className="py-2 pr-2">{tColumns("priority")}</th>
              <th className="py-2 pr-2">{tColumns("response")}</th>
              <th className="py-2 pr-2">{tColumns("resolve")}</th>
              <th className="py-2">{tColumns("respect")}</th>
            </tr>
          </thead>
          <tbody>
            {PRIORITIES.map((p) => {
              const r = rows[p];
              return (
                <tr key={p} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 pr-2 font-medium">
                    {tPriority(p)}
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      type="number"
                      min={1}
                      value={r.responseMinutes}
                      onChange={(e) =>
                        update(p, { responseMinutes: Number(e.target.value) })
                      }
                      className="w-32"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      type="number"
                      min={1}
                      value={r.resolveMinutes}
                      onChange={(e) =>
                        update(p, { resolveMinutes: Number(e.target.value) })
                      }
                      className="w-32"
                    />
                  </td>
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={r.respectBusinessHours}
                      onChange={(e) =>
                        update(p, { respectBusinessHours: e.target.checked })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SaveRow pending={isPending} saved={saved} error={error} />
    </form>
  );
}
