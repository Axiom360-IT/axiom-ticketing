CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_provider_account_unique" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint NOT NULL,
	"device_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passkeys_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret_encrypted" text NOT NULL,
	"backup_codes_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"enrolled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"language" text DEFAULT 'en' NOT NULL,
	"created_by_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"deactivated_by_id" uuid,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_by_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_number" text NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"priority" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"stream" text NOT NULL,
	"origin" text NOT NULL,
	"customer_id" uuid,
	"customer_email" text NOT NULL,
	"customer_name" text NOT NULL,
	"assigned_to_id" uuid,
	"assigned_at" timestamp with time zone,
	"is_escalated" boolean DEFAULT false NOT NULL,
	"escalated_at" timestamp with time zone,
	"escalated_by_id" uuid,
	"escalation_reason" text,
	"csat_response" text,
	"csat_responded_at" timestamp with time zone,
	"response_due_at" timestamp with time zone,
	"resolution_due_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"sla_warning_50_at" timestamp with time zone,
	"sla_warning_80_at" timestamp with time zone,
	"sla_breached_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reopened_count" integer DEFAULT 0 NOT NULL,
	"duplicate_of_id" uuid,
	"is_anonymized" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_ticket_number_unique" UNIQUE("ticket_number"),
	CONSTRAINT "tickets_category_check" CHECK ("tickets"."category" IN ('hardware','software','network','access','other')),
	CONSTRAINT "tickets_priority_check" CHECK ("tickets"."priority" IN ('low','medium','high','critical')),
	CONSTRAINT "tickets_status_check" CHECK ("tickets"."status" IN ('open','in_progress','resolved','closed')),
	CONSTRAINT "tickets_stream_check" CHECK ("tickets"."stream" IN ('internal','external')),
	CONSTRAINT "tickets_origin_check" CHECK ("tickets"."origin" IN ('web_form','email','portal')),
	CONSTRAINT "tickets_csat_check" CHECK ("tickets"."csat_response" IS NULL OR "tickets"."csat_response" IN ('satisfied','unsatisfied'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid,
	"author_email" text NOT NULL,
	"author_name" text NOT NULL,
	"author_type" text NOT NULL,
	"body" text NOT NULL,
	"channel" text NOT NULL,
	"is_internal_note" boolean DEFAULT false NOT NULL,
	"is_resolution_note" boolean DEFAULT false NOT NULL,
	"is_anonymized" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_author_type_check" CHECK ("messages"."author_type" IN ('agent','customer','system')),
	CONSTRAINT "messages_channel_check" CHECK ("messages"."channel" IN ('email','portal','dashboard','system'))
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"message_id" uuid,
	"uploaded_by_id" uuid,
	"uploaded_by_email" text NOT NULL,
	"file_name" text NOT NULL,
	"original_file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"scan_status" text DEFAULT 'pending' NOT NULL,
	"scan_completed_at" timestamp with time zone,
	"upload_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_size_check" CHECK ("attachments"."size_bytes" > 0 AND "attachments"."size_bytes" <= 10485760),
	CONSTRAINT "attachments_scan_status_check" CHECK ("attachments"."scan_status" IN ('pending','clean','quarantined'))
);
--> statement-breakpoint
CREATE TABLE "procurement_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"requested_by_id" uuid,
	"requested_by_email" text NOT NULL,
	"type" text NOT NULL,
	"item_name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"estimated_cost" numeric(12, 2),
	"vendor" text,
	"justification" text NOT NULL,
	"urgency" text NOT NULL,
	"date_needed_by" date,
	"status" text DEFAULT 'pending_coordinator_approval' NOT NULL,
	"coordinator_decision_by_id" uuid,
	"coordinator_decision_at" timestamp with time zone,
	"admin_decision_by_id" uuid,
	"admin_decision_at" timestamp with time zone,
	"rejection_reason" text,
	"rejected_at_step" text,
	"purchased_at" timestamp with time zone,
	"purchased_by_id" uuid,
	"delivered_at" timestamp with time zone,
	"delivered_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_quantity_check" CHECK ("procurement_requests"."quantity" > 0),
	CONSTRAINT "procurement_status_check" CHECK ("procurement_requests"."status" IN ('pending_coordinator_approval','pending_admin_approval','approved','rejected','purchased','delivered')),
	CONSTRAINT "procurement_type_check" CHECK ("procurement_requests"."type" IN ('hardware','software')),
	CONSTRAINT "procurement_urgency_check" CHECK ("procurement_requests"."urgency" IN ('low','medium','high')),
	CONSTRAINT "procurement_rejected_at_step_check" CHECK ("procurement_requests"."rejected_at_step" IS NULL OR "procurement_requests"."rejected_at_step" IN ('coordinator','admin'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text,
	"actor_id" uuid,
	"actor_role_snapshot" text,
	"impersonator_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before_value" jsonb,
	"after_value" jsonb,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"sms_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_preferences_user_id_event_type_pk" PRIMARY KEY("user_id","event_type")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"title_key" text NOT NULL,
	"title_args" jsonb,
	"body_key" text NOT NULL,
	"body_args" jsonb,
	"link_url" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "processed_webhook_events" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_webhook_events_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "failed_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inngest_event_id" text NOT NULL,
	"channel" text NOT NULL,
	"event_type" text NOT NULL,
	"recipient" text NOT NULL,
	"payload" jsonb,
	"error_message" text,
	"retry_count" integer NOT NULL,
	"first_attempt_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"date" date PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_deactivated_by_id_fk" FOREIGN KEY ("deactivated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_escalated_by_id_users_id_fk" FOREIGN KEY ("escalated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_duplicate_of_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_coordinator_decision_by_id_users_id_fk" FOREIGN KEY ("coordinator_decision_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_admin_decision_by_id_users_id_fk" FOREIGN KEY ("admin_decision_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_purchased_by_id_users_id_fk" FOREIGN KEY ("purchased_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_delivered_by_id_users_id_fk" FOREIGN KEY ("delivered_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_impersonator_id_users_id_fk" FOREIGN KEY ("impersonator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_created_by_id_idx" ON "users" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "users_is_active_idx" ON "users" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "role_permissions_permission_idx" ON "role_permissions" USING btree ("permission");--> statement-breakpoint
CREATE INDEX "tickets_status_priority_idx" ON "tickets" USING btree ("status","priority");--> statement-breakpoint
CREATE INDEX "tickets_assigned_to_id_idx" ON "tickets" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX "tickets_customer_id_idx" ON "tickets" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "tickets_customer_email_idx" ON "tickets" USING btree ("customer_email");--> statement-breakpoint
CREATE INDEX "tickets_is_escalated_idx" ON "tickets" USING btree ("is_escalated") WHERE "tickets"."is_escalated" = true;--> statement-breakpoint
CREATE INDEX "tickets_created_at_idx" ON "tickets" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_resolution_due_at_idx" ON "tickets" USING btree ("resolution_due_at") WHERE "tickets"."status" NOT IN ('resolved', 'closed');--> statement-breakpoint
CREATE INDEX "tickets_closed_at_anonymize_idx" ON "tickets" USING btree ("closed_at") WHERE "tickets"."is_anonymized" = false;--> statement-breakpoint
CREATE INDEX "messages_ticket_id_created_at_idx" ON "messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_ticket_id_idx" ON "attachments" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "attachments_message_id_idx" ON "attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "attachments_scan_pending_idx" ON "attachments" USING btree ("scan_status") WHERE "attachments"."scan_status" = 'pending';--> statement-breakpoint
CREATE INDEX "attachments_orphan_cleanup_idx" ON "attachments" USING btree ("created_at") WHERE "attachments"."upload_confirmed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "procurement_ticket_id_idx" ON "procurement_requests" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "procurement_status_idx" ON "procurement_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "procurement_requested_by_id_idx" ON "procurement_requests" USING btree ("requested_by_id");--> statement-breakpoint
CREATE INDEX "audit_log_timestamp_idx" ON "audit_log" USING btree ("timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_actor_id_timestamp_idx" ON "audit_log" USING btree ("actor_id","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_request_id_idx" ON "audit_log" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_unread_idx" ON "notifications" USING btree ("user_id","is_read","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_archive_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "processed_webhook_events_received_at_idx" ON "processed_webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "failed_notifications_active_idx" ON "failed_notifications" USING btree ("last_attempt_at") WHERE "failed_notifications"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "failed_notifications_last_attempt_idx" ON "failed_notifications" USING btree ("last_attempt_at");
--> statement-breakpoint
-- ─────────────────────────────────────────────────────────────────────
-- M1 custom additions (not generated by drizzle-kit)
-- ─────────────────────────────────────────────────────────────────────

-- Ticket numbering: human-readable AX-XXXX format.
-- Called by application code on ticket insert (src/lib/ticket-number.ts).
CREATE SEQUENCE IF NOT EXISTS ax_ticket_seq;--> statement-breakpoint

CREATE OR REPLACE FUNCTION generate_ticket_number() RETURNS text AS $$
  SELECT 'AX-' || LPAD(nextval('ax_ticket_seq')::text, 4, '0');
$$ LANGUAGE SQL VOLATILE;--> statement-breakpoint

-- 5-second statement_timeout for runtime queries.
-- Affects every new connection (Neon HTTP driver opens fresh per query).
-- Reporting role with extended timeout (60s) is created later in M13.
DO $$
BEGIN
  EXECUTE 'ALTER ROLE ' || quote_ident(current_user) || ' SET statement_timeout = ''5s''';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not set statement_timeout (insufficient privileges) — apply manually if running as a non-owner role.';
END $$;--> statement-breakpoint

-- Note on audit_log append-only enforcement:
-- DB-level triggers blocking UPDATE/DELETE would also block the legitimate
-- retention-audit cron (deletes rows > 3 years). Append-only is enforced
-- at the application layer:
--   1. Only src/lib/audit.ts writes to audit_log.
--   2. The Drizzle schema exports no update() or delete() method for it.
--   3. The retention cron uses a controlled, audited deletion path.
