"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createTicketOnBehalf } from "@/app/actions/tickets";

const CATEGORY_OPTIONS = [
  "hardware",
  "software",
  "network",
  "access",
  "other",
] as const;

const PRIORITY_OPTIONS = ["low", "medium", "high", "critical"] as const;

type CategoryValue = (typeof CATEGORY_OPTIONS)[number];
type PriorityValue = (typeof PRIORITY_OPTIONS)[number];

// Sentinel for "no organization" (the Select needs a non-empty value).
const NO_ORG = "__none__";

type OrgOption = { id: string; name: string };

export function CreateOnBehalfForm({
  organizations = [],
}: {
  organizations?: OrgOption[];
}) {
  const router = useRouter();
  const tFields = useTranslations("tickets.submit.fields");
  const tSubmit = useTranslations("tickets.submit");
  const tActions = useTranslations("tickets.actions");
  const tCategory = useTranslations("tickets.category");
  const tPriority = useTranslations("tickets.priority");
  const tCommon = useTranslations("common");

  const [data, setData] = useState({
    customerName: "",
    customerEmail: "",
    organizationId: NO_ORG,
    subject: "",
    category: "" as "" | CategoryValue,
    priority: "" as "" | PriorityValue,
    description: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof data>(
    key: K,
    value: (typeof data)[K],
  ) {
    setData((d) => ({ ...d, [key]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!data.category || !data.priority) {
      setError(tSubmit("chooseCategoryPriority"));
      return;
    }
    setSubmitting(true);
    const res = await createTicketOnBehalf({
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      organizationId:
        data.organizationId === NO_ORG ? undefined : data.organizationId,
      subject: data.subject,
      category: data.category,
      priority: data.priority,
      description: data.description,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push("/admin/tickets");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="grid sm:grid-cols-2 gap-5">
        <div className="space-y-1.5">
          <Label htmlFor="customerName">{tFields("customerName")}</Label>
          <Input
            id="customerName"
            required
            value={data.customerName}
            onChange={(e) => update("customerName", e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customerEmail">{tFields("customerEmail")}</Label>
          <Input
            id="customerEmail"
            type="email"
            required
            value={data.customerEmail}
            onChange={(e) => update("customerEmail", e.target.value)}
          />
        </div>
      </div>

      {organizations.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor="organization">{tFields("organization")}</Label>
          <Select
            items={{
              [NO_ORG]: tFields("organizationNone"),
              ...Object.fromEntries(organizations.map((o) => [o.id, o.name])),
            }}
            value={data.organizationId}
            onValueChange={(v) => update("organizationId", v ?? NO_ORG)}
          >
            <SelectTrigger id="organization">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ORG}>{tFields("organizationNone")}</SelectItem>
              {organizations.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="subject">{tFields("subject")}</Label>
        <Input
          id="subject"
          required
          value={data.subject}
          onChange={(e) => update("subject", e.target.value)}
          maxLength={150}
          placeholder={tFields("subjectAgentPlaceholder")}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        <div className="space-y-1.5">
          <Label htmlFor="category">{tFields("category")}</Label>
          <Select
            items={Object.fromEntries(
              CATEGORY_OPTIONS.map((v) => [v, tCategory(v)]),
            )}
            value={data.category}
            onValueChange={(v) => update("category", v as typeof data.category)}
          >
            <SelectTrigger id="category">
              <SelectValue placeholder={tFields("categoryPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {tCategory(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="priority">{tFields("priority")}</Label>
          <Select
            items={Object.fromEntries(
              PRIORITY_OPTIONS.map((v) => [v, tPriority(v)]),
            )}
            value={data.priority}
            onValueChange={(v) => update("priority", v as typeof data.priority)}
          >
            <SelectTrigger id="priority">
              <SelectValue placeholder={tFields("priorityPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {tPriority(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">{tFields("description")}</Label>
        <Textarea
          id="description"
          required
          value={data.description}
          onChange={(e) => update("description", e.target.value)}
          minLength={20}
          maxLength={5000}
          rows={6}
          placeholder={tFields("descriptionAgentPlaceholder")}
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {data.description.length}/5000
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400"
        >
          {error}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/tickets")}
        >
          {tCommon("cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? tActions("createPending") : tActions("createTicket")}
        </Button>
      </div>
    </form>
  );
}
