"use client";

import { type FormEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type CustomerSearchHit,
  searchTicketCustomers,
  setTicketCustomer,
} from "@/app/actions/tickets";

// Lets a technician correct the customer on a ticket — used when a forwarded
// email made the FORWARDER the customer instead of the real person. You can
// SEARCH an existing customer (picking one links their account, so their phone
// shows and notifications reach them) or type a brand-new name + email.
export function EditCustomerControl({
  ticketId,
  currentName,
  currentEmail,
}: {
  ticketId: string;
  currentName: string;
  currentEmail: string;
}) {
  const router = useRouter();
  const t = useTranslations("tickets.editCustomer");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(currentName);
  const [email, setEmail] = useState(currentEmail);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerSearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQuery = useRef("");

  function onQueryChange(v: string) {
    setQuery(v);
    const q = v.trim();
    latestQuery.current = q;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.length < 2) {
      setResults([]);
      return;
    }
    // Debounce the type-ahead lookup, and drop stale responses (an earlier
    // search resolving after a newer keystroke) by matching against the ref.
    timerRef.current = setTimeout(() => {
      void searchTicketCustomers(q).then((rows) => {
        if (latestQuery.current === q) setResults(rows);
      });
    }, 250);
  }

  function pick(c: CustomerSearchHit) {
    setName(c.name);
    setEmail(c.email);
    setQuery("");
    setResults([]);
  }

  function open() {
    setName(currentName);
    setEmail(currentEmail);
    setQuery("");
    setResults([]);
    setError(null);
    setEditing(true);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await setTicketCustomer(ticketId, {
        name: name.trim(),
        email: email.trim(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={open}
        className="mt-1 text-xs text-blue-700 hover:underline dark:text-blue-400"
      >
        {t("button")}
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2" noValidate>
      <div className="relative space-y-1">
        <label
          htmlFor={`cust-search-${ticketId}`}
          className="block text-xs text-zinc-500 dark:text-zinc-400"
        >
          {t("searchLabel")}
        </label>
        <Input
          id={`cust-search-${ticketId}`}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("searchPlaceholder")}
          autoComplete="off"
        />
        {results.length > 0 ? (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pick(c)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="block font-medium">{c.name}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {c.email}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("orNew")}</p>

      <div className="space-y-1">
        <label
          htmlFor={`cust-name-${ticketId}`}
          className="block text-xs text-zinc-500 dark:text-zinc-400"
        >
          {t("nameLabel")}
        </label>
        <Input
          id={`cust-name-${ticketId}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
        />
      </div>
      <div className="space-y-1">
        <label
          htmlFor={`cust-email-${ticketId}`}
          className="block text-xs text-zinc-500 dark:text-zinc-400"
        >
          {t("emailLabel")}
        </label>
        <Input
          id={`cust-email-${ticketId}`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setEditing(false)}
          disabled={pending}
        >
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
