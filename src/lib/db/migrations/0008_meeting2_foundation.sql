CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"abbreviation" text NOT NULL,
	"is_monthly_plan" boolean DEFAULT false NOT NULL,
	"monthly_minutes_included" integer,
	"monthly_minutes_balance" integer,
	"contract_notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_name_unique" UNIQUE("name"),
	CONSTRAINT "organizations_abbreviation_unique" UNIQUE("abbreviation"),
	CONSTRAINT "organizations_abbreviation_format_check" CHECK ("organizations"."abbreviation" ~ '^[A-Z0-9]{2,5}$')
);
--> statement-breakpoint
CREATE TABLE "ticket_assignees" (
	"ticket_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_by_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_assignees_ticket_id_user_id_pk" PRIMARY KEY("ticket_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "work_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"technician_id" uuid,
	"description" text NOT NULL,
	"minutes" integer NOT NULL,
	"service_type" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_logs_minutes_check" CHECK ("work_logs"."minutes" > 0),
	CONSTRAINT "work_logs_service_type_check" CHECK ("work_logs"."service_type" IN ('onsite','remote'))
);
--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_status_check";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "billable" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "escalation_target_role" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizations_name_idx" ON "organizations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "organizations_abbreviation_idx" ON "organizations" USING btree ("abbreviation");--> statement-breakpoint
CREATE INDEX "organizations_is_active_idx" ON "organizations" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "ticket_assignees_user_id_idx" ON "ticket_assignees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "work_logs_ticket_id_idx" ON "work_logs" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "work_logs_technician_id_idx" ON "work_logs" USING btree ("technician_id");--> statement-breakpoint
CREATE INDEX "work_logs_created_at_idx" ON "work_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_organization_id_idx" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tickets_organization_id_idx" ON "tickets" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_billable_check" CHECK ("tickets"."billable" IS NULL OR "tickets"."billable" IN ('yes','no','monthly_plan','project','rework'));--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_status_check" CHECK ("tickets"."status" IN ('draft','open','in_progress','awaiting_customer_confirmation','escalation','resolved','closed'));--> statement-breakpoint
-- users.organization_id FK is added by hand: the column is declared as a plain
-- uuid in auth.ts to avoid a schema import cycle with organizations.ts, so
-- drizzle-kit does not emit this constraint automatically.
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ── New ticket-number format (Meeting-2, CR-07) ───────────────────────
-- Format: <ORG_ABBREV>-<YYYYMMDD>-<NNN>  e.g. KI-20260522-001
-- The number is generated once at ticket creation and stored on the row, so
-- it never changes and a later reply never spawns a new ticket. A per-(prefix,
-- day) counter table makes the daily sequence atomic under concurrency. This
-- follows the same custom-SQL pattern as the original generator in 0000 (these
-- objects are intentionally NOT part of the Drizzle schema).
CREATE TABLE IF NOT EXISTS "ticket_number_counters" (
	"prefix" text NOT NULL,
	"day" text NOT NULL,
	"last_seq" integer NOT NULL DEFAULT 0,
	CONSTRAINT "ticket_number_counters_pk" PRIMARY KEY ("prefix", "day")
);--> statement-breakpoint

-- Replace the old AX-#### generator. Defaults keep any caller that passes no
-- args working (prefix 'AX', UTC day). Callers pass the org abbreviation and
-- the business timezone so the date reflects local wall-clock.
DROP FUNCTION IF EXISTS generate_ticket_number();--> statement-breakpoint
CREATE OR REPLACE FUNCTION generate_ticket_number(p_prefix text DEFAULT 'AX', p_tz text DEFAULT 'UTC')
RETURNS text AS $$
DECLARE
	v_prefix text := upper(coalesce(nullif(regexp_replace(trim(p_prefix), '[^A-Za-z0-9]', '', 'g'), ''), 'AX'));
	v_day text := to_char((now() AT TIME ZONE coalesce(nullif(trim(p_tz), ''), 'UTC')), 'YYYYMMDD');
	v_seq integer;
BEGIN
	INSERT INTO ticket_number_counters (prefix, day, last_seq)
	VALUES (v_prefix, v_day, 1)
	ON CONFLICT (prefix, day)
	DO UPDATE SET last_seq = ticket_number_counters.last_seq + 1
	RETURNING last_seq INTO v_seq;
	RETURN v_prefix || '-' || v_day || '-' || lpad(v_seq::text, 3, '0');
END;
$$ LANGUAGE plpgsql VOLATILE;--> statement-breakpoint

-- Grant the new organizations.* permissions to existing seeded system roles so
-- an already-seeded database picks them up on migrate (db:seed is a no-op once
-- roles exist). Idempotent via the role_permissions (role_id, permission) PK.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r.id, p.permission
FROM "roles" r
CROSS JOIN (VALUES
	('organizations.view'),
	('organizations.create'),
	('organizations.update'),
	('organizations.delete')
) AS p(permission)
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r.id, p.permission
FROM "roles" r
CROSS JOIN (VALUES
	('organizations.view'),
	('organizations.create'),
	('organizations.update')
) AS p(permission)
WHERE r.name = 'Coordinator'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r.id, 'organizations.view'
FROM "roles" r
WHERE r.name = 'IT Director'
ON CONFLICT DO NOTHING;