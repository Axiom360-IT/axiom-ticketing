import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ticketReviews } from "@/lib/db/schema/ticket-reviews";

export type LatestTicketReview = {
  rating: string;
  comment: string | null;
  technicianName: string | null;
  createdAt: Date;
};

/**
 * The most recent CSAT review for a ticket (a ticket can accrue several across
 * reopen → re-resolve cycles). Surfaced on the admin ticket detail so the
 * technician sees the customer's emoji rating + comment.
 */
export async function getLatestTicketReview(
  ticketId: string,
): Promise<LatestTicketReview | null> {
  const [r] = await db
    .select({
      rating: ticketReviews.rating,
      comment: ticketReviews.comment,
      technicianName: ticketReviews.technicianName,
      createdAt: ticketReviews.createdAt,
    })
    .from(ticketReviews)
    .where(eq(ticketReviews.ticketId, ticketId))
    .orderBy(desc(ticketReviews.createdAt))
    .limit(1);
  return r ?? null;
}
