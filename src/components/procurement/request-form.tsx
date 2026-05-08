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
import { createProcurementRequest } from "@/app/actions/procurement";

const TYPES = ["hardware", "software"] as const;
const URGENCIES = ["low", "medium", "high"] as const;

type Props = {
  ticketId: string;
  onCancel: () => void;
};

export function ProcurementRequestForm({ ticketId, onCancel }: Props) {
  const router = useRouter();
  const tForm = useTranslations("procurement.form");
  const tType = useTranslations("procurement.type");
  const tUrgency = useTranslations("procurement.urgency");
  const tCommon = useTranslations("common");

  const [type, setType] = useState<"" | (typeof TYPES)[number]>("");
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [estimatedCost, setEstimatedCost] = useState("");
  const [vendor, setVendor] = useState("");
  const [justification, setJustification] = useState("");
  const [urgency, setUrgency] = useState<"" | (typeof URGENCIES)[number]>("");
  const [dateNeededBy, setDateNeededBy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!type || !urgency) return;
    setSubmitting(true);
    const res = await createProcurementRequest({
      ticketId,
      type,
      itemName,
      quantity,
      estimatedCost: estimatedCost.trim() || undefined,
      vendor: vendor.trim() || undefined,
      justification,
      urgency,
      dateNeededBy: dateNeededBy || undefined,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCancel();
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="proc-type">{tForm("type")}</Label>
          <Select
            value={type}
            onValueChange={(v) => setType(v as typeof type)}
          >
            <SelectTrigger id="proc-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((v) => (
                <SelectItem key={v} value={v}>
                  {tType(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="proc-urgency">{tForm("urgency")}</Label>
          <Select
            value={urgency}
            onValueChange={(v) => setUrgency(v as typeof urgency)}
          >
            <SelectTrigger id="proc-urgency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {URGENCIES.map((v) => (
                <SelectItem key={v} value={v}>
                  {tUrgency(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="proc-itemName">{tForm("itemName")}</Label>
        <Input
          id="proc-itemName"
          required
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          maxLength={200}
        />
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="proc-quantity">{tForm("quantity")}</Label>
          <Input
            id="proc-quantity"
            type="number"
            min={1}
            required
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="proc-cost">{tForm("estimatedCost")}</Label>
          <Input
            id="proc-cost"
            inputMode="decimal"
            value={estimatedCost}
            onChange={(e) => setEstimatedCost(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="proc-vendor">{tForm("vendor")}</Label>
          <Input
            id="proc-vendor"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            maxLength={200}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="proc-needed">{tForm("dateNeededBy")}</Label>
        <Input
          id="proc-needed"
          type="date"
          value={dateNeededBy}
          onChange={(e) => setDateNeededBy(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="proc-justification">{tForm("justification")}</Label>
        <Textarea
          id="proc-justification"
          rows={4}
          required
          minLength={10}
          maxLength={2000}
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder={tForm("justificationHint")}
        />
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
          onClick={onCancel}
          disabled={submitting}
        >
          {tCommon("cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? tForm("submitting") : tForm("submit")}
        </Button>
      </div>
    </form>
  );
}
