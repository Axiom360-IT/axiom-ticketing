ALTER TABLE "procurement_requests" DROP CONSTRAINT "procurement_urgency_check";--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP CONSTRAINT "procurement_rejected_at_step_check";--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP CONSTRAINT "procurement_status_check";--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP CONSTRAINT "procurement_type_check";--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP CONSTRAINT "procurement_requests_coordinator_decision_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP CONSTRAINT "procurement_requests_admin_decision_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP CONSTRAINT "procurement_requests_purchased_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP CONSTRAINT "procurement_requests_delivered_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "procurement_requests" ALTER COLUMN "status" SET DEFAULT 'awaiting_customer_payment';--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP COLUMN "urgency";--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP COLUMN "coordinator_decision_by_id";--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP COLUMN "coordinator_decision_at";--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP COLUMN "admin_decision_by_id";--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP COLUMN "admin_decision_at";--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP COLUMN "rejection_reason";--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP COLUMN "rejected_at_step";--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP COLUMN "purchased_at";--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP COLUMN "purchased_by_id";--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP COLUMN "delivered_at";--> statement-breakpoint
ALTER TABLE "procurement_requests" DROP COLUMN "delivered_by_id";--> statement-breakpoint

-- Remap existing rows to the new 4-stage model (CR-26) BEFORE applying the new
-- status CHECK, so legacy values don't violate it. Reject had no equivalent in
-- the new model and is closed out as completed.
UPDATE "procurement_requests" SET "status" = 'awaiting_customer_payment'
  WHERE "status" IN ('pending_coordinator_approval','pending_admin_approval');--> statement-breakpoint
UPDATE "procurement_requests" SET "status" = 'order_pending' WHERE "status" = 'approved';--> statement-breakpoint
UPDATE "procurement_requests" SET "status" = 'order_placed' WHERE "status" = 'purchased';--> statement-breakpoint
UPDATE "procurement_requests" SET "status" = 'order_completed' WHERE "status" IN ('delivered','rejected');--> statement-breakpoint

ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_status_check" CHECK ("procurement_requests"."status" IN ('awaiting_customer_payment','order_pending','order_placed','order_completed'));--> statement-breakpoint
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_type_check" CHECK ("procurement_requests"."type" IN ('hardware','software','other'));--> statement-breakpoint

-- Meeting-2 CR-24: grant the new procurement.manage permission to the roles
-- that previously held the approval/fulfilment permissions. Idempotent.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r.id, 'procurement.manage'
FROM "roles" r
WHERE r.name IN ('Super Admin', 'Coordinator')
ON CONFLICT DO NOTHING;