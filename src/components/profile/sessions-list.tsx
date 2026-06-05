"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  type ProfileSession,
  revokeOtherSessions,
  revokeSession,
} from "@/app/actions/profile";

type Props = {
  initial: ProfileSession[];
};

export function SessionsList({ initial }: Props) {
  const router = useRouter();
  const t = useTranslations("profile.sessions");
  const formatter = useFormatter();
  const [items, setItems] = useState<ProfileSession[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRevoke(token: string) {
    setError(null);
    setRevokingToken(token);
    startTransition(async () => {
      const res = await revokeSession(token);
      setRevokingToken(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems((prev) => prev.filter((s) => s.token !== token));
      router.refresh();
    });
  }

  function handleRevokeOthers() {
    setError(null);
    startTransition(async () => {
      await revokeOtherSessions();
      setItems((prev) => prev.filter((s) => s.isCurrent));
      router.refresh();
    });
  }

  const otherCount = items.filter((s) => !s.isCurrent).length;

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {items.map((s) => (
          <li
            key={s.token}
            className="flex items-start gap-3 px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap text-sm min-w-0">
                <span className="font-medium truncate min-w-0 max-w-full">
                  {s.userAgent ?? t("unknownDevice")}
                </span>
                {s.isCurrent ? (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950 dark:border-blue-900 dark:text-blue-300">
                    {t("currentBadge")}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {s.ipAddress ?? t("unknownIp")} ·{" "}
                {t("lastActive", {
                  when: formatter.relativeTime(s.updatedAt, {
                    now: new Date(),
                  }),
                })}{" "}
                ·{" "}
                {t("expires", {
                  when: formatter.dateTime(s.expiresAt, { dateStyle: "short" }),
                })}
              </p>
            </div>
            {!s.isCurrent ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleRevoke(s.token)}
                disabled={isPending && revokingToken === s.token}
              >
                {isPending && revokingToken === s.token
                  ? t("revoking")
                  : t("revokeButton")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {otherCount > 0 ? (
        <Button
          variant="outline"
          onClick={handleRevokeOthers}
          disabled={isPending}
        >
          {isPending && revokingToken === null
            ? t("revokingOthers")
            : t("revokeOthers")}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
