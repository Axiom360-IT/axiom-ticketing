"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setTicketCustomer } from "@/app/actions/tickets";

// Lets a technician correct the customer on a ticket — used when a forwarded
// email made the FORWARDER the customer instead of the real person. Setting the
// right name + email means future notifications reach the actual customer (the
// fan-out keys off the ticket's customer).
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
        onClick={() => {
          setName(currentName);
          setEmail(currentEmail);
          setError(null);
          setEditing(true);
        }}
        className="mt-1 text-xs text-blue-700 hover:underline dark:text-blue-400"
      >
        {t("button")}
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2" noValidate>
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
