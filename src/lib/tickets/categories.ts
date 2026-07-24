import "server-only";
import { cache } from "react";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ticketCategories } from "@/lib/db/schema/ticket-categories";

export type TicketCategoryOption = {
  id: string;
  value: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
};

// Cached per request so the many render sites (forms, filters, badges) that
// need the category list share one query.
export const loadAllTicketCategories = cache(
  async (): Promise<TicketCategoryOption[]> => {
    return db
      .select({
        id: ticketCategories.id,
        value: ticketCategories.value,
        label: ticketCategories.label,
        sortOrder: ticketCategories.sortOrder,
        isActive: ticketCategories.isActive,
        isDefault: ticketCategories.isDefault,
      })
      .from(ticketCategories)
      .orderBy(asc(ticketCategories.sortOrder), asc(ticketCategories.label));
  },
);

/** Active categories only — for pickers/dropdowns. */
export async function loadActiveTicketCategories(): Promise<
  TicketCategoryOption[]
> {
  return (await loadAllTicketCategories()).filter((c) => c.isActive);
}

/** value → label for ALL categories (incl. inactive) so historical tickets
 *  whose category was later retired still render a proper label. */
export const getCategoryLabelMap = cache(
  async (): Promise<Record<string, string>> => {
    const all = await loadAllTicketCategories();
    const map: Record<string, string> = {};
    for (const c of all) map[c.value] = c.label;
    return map;
  },
);

/** The default category value new/guest/inbound tickets fall back to. */
export async function getDefaultCategoryValue(): Promise<string> {
  const all = await loadAllTicketCategories();
  return all.find((c) => c.isDefault)?.value ?? "other";
}

/** True when `value` is an ACTIVE category (used to validate staff input). */
export async function isActiveCategoryValue(value: string): Promise<boolean> {
  return (await loadActiveTicketCategories()).some((c) => c.value === value);
}
