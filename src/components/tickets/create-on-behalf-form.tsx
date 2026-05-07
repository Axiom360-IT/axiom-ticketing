"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
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
  { value: "hardware", label: "Hardware" },
  { value: "software", label: "Software" },
  { value: "network", label: "Network" },
  { value: "access", label: "Access" },
  { value: "other", label: "Other" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
] as const;

export function CreateOnBehalfForm() {
  const router = useRouter();

  const [data, setData] = useState({
    customerName: "",
    customerEmail: "",
    subject: "",
    category: "" as "" | (typeof CATEGORY_OPTIONS)[number]["value"],
    priority: "" as "" | (typeof PRIORITY_OPTIONS)[number]["value"],
    description: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof data>(key: K, value: (typeof data)[K]) {
    setData((d) => ({ ...d, [key]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!data.category || !data.priority) {
      setError("Choose a category and priority.");
      return;
    }
    setSubmitting(true);
    const res = await createTicketOnBehalf({
      customerName: data.customerName,
      customerEmail: data.customerEmail,
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
          <Label htmlFor="customerName">Customer name</Label>
          <Input
            id="customerName"
            required
            value={data.customerName}
            onChange={(e) => update("customerName", e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customerEmail">Customer email</Label>
          <Input
            id="customerEmail"
            type="email"
            required
            value={data.customerEmail}
            onChange={(e) => update("customerEmail", e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="subject">Subject</Label>
        <Input
          id="subject"
          required
          value={data.subject}
          onChange={(e) => update("subject", e.target.value)}
          maxLength={150}
          placeholder="Short summary as the customer described it"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <Select
            value={data.category}
            onValueChange={(v) => update("category", v as typeof data.category)}
          >
            <SelectTrigger id="category">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="priority">Priority</Label>
          <Select
            value={data.priority}
            onValueChange={(v) => update("priority", v as typeof data.priority)}
          >
            <SelectTrigger id="priority">
              <SelectValue placeholder="Select priority" />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          required
          value={data.description}
          onChange={(e) => update("description", e.target.value)}
          minLength={20}
          maxLength={5000}
          rows={6}
          placeholder="What did the customer report? Include any context they gave."
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
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create ticket"}
        </Button>
      </div>
    </form>
  );
}
