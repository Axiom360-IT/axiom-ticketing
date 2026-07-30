import { eventType } from "inngest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { roles } from "@/lib/db/schema/rbac";
import { provisionUser } from "@/lib/users/provision";
import { sendCustomerSetupInvite } from "@/lib/customer/invite";
import { audit } from "@/lib/audit";
import { inngest } from "../client";

// Processes one uploaded customer list (see app/actions/customer-import.ts's
// commitCustomerImport, which resolves every row's organization BEFORE
// sending this event — this function only provisions accounts). One
// step.run per row: a bad/duplicate row fails on its own without sinking
// the rest, and if the function itself gets retried (Inngest-level, not
// per-row), already-completed rows are memoized and skipped.
//
// Deliberately does NOT throw per-row failures — `provisionUser` and
// `sendCustomerSetupInvite` already return {ok:false} rather than throw, so
// a permanently-bad row (duplicate email, org gone) wouldn't benefit from
// Inngest's retry anyway. The batch summary + audit entry is the admin's
// signal to fix and re-import just the failed emails.

type EventData = {
  batchId: string;
  importedById: string;
  rows: { name: string; email: string; phone: string; organizationId: string }[];
};

type RowOutcome =
  | { status: "created"; userId: string; inviteSent: boolean; inviteError?: string }
  | { status: "failed"; error: string };

export const processCustomerImportBatch = inngest.createFunction(
  {
    id: "process-customer-import-batch",
    retries: 2,
    triggers: eventType("customer-import/batch.requested"),
    idempotency: "event.data.batchId",
  },
  async ({ event, step }) => {
    const { batchId, importedById, rows } = event.data as EventData;

    const customerRoleId = await step.run("load-customer-role", async () => {
      const [role] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, "Customer"))
        .limit(1);
      if (!role) {
        throw new Error("Customer role missing — run pnpm db:seed before importing.");
      }
      return role.id;
    });

    let created = 0;
    let failed = 0;
    let inviteSendFailures = 0;
    const failureDetails: { email: string; error: string }[] = [];

    for (const row of rows) {
      const outcome: RowOutcome = await step.run(
        `provision-${row.email}`,
        async () => {
          const invitedAt = new Date();
          const result = await provisionUser({
            name: row.name,
            email: row.email,
            organizationId: row.organizationId,
            phone: row.phone || undefined,
            roleIds: [customerRoleId],
            createdById: importedById,
            invitedAt,
            // Placeholder — sendCustomerSetupInvite immediately recomputes
            // this from the LIVE customer_invite.expiry_hours setting.
            inviteExpiresAt: invitedAt,
          });
          if (!result.ok) {
            return { status: "failed" as const, error: result.error };
          }

          await audit({
            actorId: importedById,
            action: "user.create",
            targetType: "user",
            targetId: result.userId,
            after: { email: row.email, organizationId: row.organizationId, batchId },
          });

          const sendResult = await sendCustomerSetupInvite({
            userId: result.userId,
            name: row.name,
            email: row.email,
            organizationId: row.organizationId,
            flow: "set",
          });
          return {
            status: "created" as const,
            userId: result.userId,
            inviteSent: sendResult.ok,
            inviteError: sendResult.ok ? undefined : sendResult.error,
          };
        },
      );

      if (outcome.status === "created") {
        created++;
        if (!outcome.inviteSent) {
          inviteSendFailures++;
          failureDetails.push({
            email: row.email,
            error: `Account created but invite email failed: ${outcome.inviteError}`,
          });
        }
      } else {
        failed++;
        failureDetails.push({ email: row.email, error: outcome.error });
      }
    }

    await step.run("audit-batch-summary", async () => {
      await audit({
        actorId: importedById,
        action: "user.bulk_import",
        targetType: "user",
        targetId: batchId,
        after: {
          batchId,
          requested: rows.length,
          created,
          failed,
          inviteSendFailures,
        },
      });
    });

    await step.run("notify-importer", async () => {
      await inngest.send({
        name: "notification/in-app",
        data: {
          userId: importedById,
          eventType: "user.bulk_import_completed",
          titleKey: "notifications.userImport.completed.title",
          bodyKey: "notifications.userImport.completed.body",
          bodyArgs: { created, failed },
          linkUrl: "/admin/users?tab=external",
        },
      });
    });

    return { batchId, created, failed, inviteSendFailures, failureDetails };
  },
);
