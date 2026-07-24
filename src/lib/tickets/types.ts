import "server-only";
import { cache } from "react";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ticketTypes } from "@/lib/db/schema/ticket-types";

export type TicketTypeOption = {
  id: string;
  value: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
};

// Cached per request so the render sites (forms, filters, badges) share a query.
export const loadAllTicketTypes = cache(
  async (): Promise<TicketTypeOption[]> => {
    return db
      .select({
        id: ticketTypes.id,
        value: ticketTypes.value,
        label: ticketTypes.label,
        sortOrder: ticketTypes.sortOrder,
        isActive: ticketTypes.isActive,
        isDefault: ticketTypes.isDefault,
      })
      .from(ticketTypes)
      .orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.label));
  },
);

/** Active types only — for pickers/dropdowns. */
export async function loadActiveTicketTypes(): Promise<TicketTypeOption[]> {
  return (await loadAllTicketTypes()).filter((t) => t.isActive);
}

/** value → label for ALL types (incl. inactive) for historical tickets. */
export const getTypeLabelMap = cache(
  async (): Promise<Record<string, string>> => {
    const all = await loadAllTicketTypes();
    const map: Record<string, string> = {};
    for (const t of all) map[t.value] = t.label;
    return map;
  },
);

/** The default type new/guest/inbound tickets fall back to. */
export async function getDefaultTypeValue(): Promise<string> {
  const all = await loadAllTicketTypes();
  return all.find((t) => t.isDefault)?.value ?? "service_request";
}

/** True when `value` is an ACTIVE type (used to validate staff input). */
export async function isActiveTypeValue(value: string): Promise<boolean> {
  return (await loadActiveTicketTypes()).some((t) => t.value === value);
}
