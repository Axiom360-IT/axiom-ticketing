CREATE TABLE "ticket_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"added_via" text DEFAULT 'domain_auto' NOT NULL,
	"added_by_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_participants_ticket_email_key" UNIQUE("ticket_id","email"),
	CONSTRAINT "ticket_participants_added_via_check" CHECK ("ticket_participants"."added_via" IN ('domain_auto','moderation','agent')),
	CONSTRAINT "ticket_participants_status_check" CHECK ("ticket_participants"."status" IN ('active','removed'))
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "moderation_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "held_reason" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reviewed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_participants_ticket_id_idx" ON "ticket_participants" USING btree ("ticket_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_moderation_status_check" CHECK ("messages"."moderation_status" IN ('approved','held','rejected'));