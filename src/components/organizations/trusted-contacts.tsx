"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import {
  removeOrganizationTrustedContact,
  type TrustedContact,
} from "@/app/actions/organizations";

// Org-scoped trusted email contacts (req 5.2 follow-up). Added via the
// moderation queue's "Approve & trust"; listed here so trust can be REVOKED —
// removing a contact means they're moderated again on their next reply.
export function TrustedContacts({
  organizationId,
  initial,
  canRemove,
}: {
  organizationId: string;
  initial: TrustedContact[];
  canRemove: boolean;
}) {
  const t = useTranslations("organizations.trusted");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(email: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeOrganizationTrustedContact(organizationId, email);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  if (initial.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {initial.map((c) => (
          <li
            key={c.email}
            className="flex items-center justify-between gap-3 py-2"
          >
            <div className="min-w-0 text-sm">
              {c.name ? (
                <span className="text-zinc-800 dark:text-zinc-200">
                  {c.name}{" "}
                </span>
              ) : null}
              <span className="text-zinc-500 dark:text-zinc-400">
                {c.email}
              </span>
            </div>
            {canRemove ? (
              <button
                type="button"
                onClick={() => remove(c.email)}
                disabled={pending}
                className="shrink-0 text-zinc-500 hover:text-red-600 disabled:opacity-50"
                aria-label={t("remove")}
                title={t("remove")}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
