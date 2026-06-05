"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useReauthGate } from "@/components/shared/use-reauth-gate";
import { updateSetting } from "@/app/actions/settings";

type Props = {
  settingKey: string;
  initial: string[];
  /** Translation namespace for { addPlaceholder, addButton, remove, empty }. */
  i18nNamespace: string;
};

export function StringListForm({ settingKey, initial, i18nNamespace }: Props) {
  const router = useRouter();
  const { runWithReauth, gate } = useReauthGate();
  const t = useTranslations(i18nNamespace);
  const [items, setItems] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function commit(next: string[]) {
    startTransition(async () => {
      setError(null);
      const res = await runWithReauth(
        () => updateSetting(settingKey, next),
        "settings",
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems(next);
      router.refresh();
    });
  }

  function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = draft.trim().toLowerCase();
    if (!v) return;
    if (items.includes(v)) {
      setDraft("");
      return;
    }
    const next = [...items, v];
    setDraft("");
    commit(next);
  }

  function handleRemove(value: string) {
    commit(items.filter((x) => x !== value));
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("addPlaceholder")}
          className="max-w-md"
        />
        <Button type="submit" variant="outline" disabled={isPending}>
          {t("addButton")}
        </Button>
      </form>

      {items.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {items.map((v) => (
            <li
              key={v}
              className="inline-flex max-w-full min-w-0 items-center gap-2 px-2.5 py-1 rounded-full border border-zinc-200 dark:border-zinc-800 text-xs"
            >
              <span className="break-all">{v}</span>
              <button
                type="button"
                onClick={() => handleRemove(v)}
                disabled={isPending}
                className="-mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:text-red-600"
                aria-label={t("remove")}
              >
                <Trash2 className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {gate}
    </div>
  );
}
