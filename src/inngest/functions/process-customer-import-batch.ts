import { eventType } from "inngest";
import { finishCustomerProvisioning } from "@/lib/users/provision";
import { sendCustomerSetupInvite } from "@/lib/customer/invite";
import { audit } from "@/lib/audit";
import { inngest } from "../client";

// Processes one uploaded customer list (see app/actions/customer-import.ts's
// commitCustomerImport, which resolves every row's organization AND already
// creates each row's `users` stub — visible on the admin list as
// "provisioning" — BEFORE sending this event; this function only finishes
// what's already there: role grant, accounts row, invite email). One
// step.run per row: a bad/duplicate row fails on its own without sinking
// the rest, and if the function itself gets retried (Inngest-level, not
// per-row), already-completed rows are memoized and skipped.
//
// Deliberately does NOT throw per-row failures — `finishCustomerProvisioning`
// and `sendCustomerSetupInvite` already return {ok:false} rather than throw,
// so a permanently-bad row wouldn't benefit from Inngest's retry anyway. The
// batch summary + audit entry is the admin's signal something needs
// attention — note that unlike before this stub-row split, a row that fails
// here can no longer simply be re-imported (its email now already has a
// `users` row, so a re-import sees it as a duplicate) — it needs a manual
// fix, not a re-run of the same file.

type EventData = {
  batchId: string;
  importedById: string;
  customerRoleId: string;
  rows: {
    userId: string;
    name: string;
    email: string;
    phone: string;
    organizationId: string;
  }[];
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
    const { batchId, importedById, customerRoleId, rows } = event.data as EventData;

    let created = 0;
    let failed = 0;
    let inviteSendFailures = 0;
    const failureDetails: { email: string; error: string }[] = [];

    for (const row of rows) {
      const outcome: RowOutcome = await step.run(
        `finish-provisioning-${row.email}`,
        async () => {
          const result = await finishCustomerProvisioning({
            userId: row.userId,
            email: row.email,
            roleIds: [customerRoleId],
            createdById: importedById,
          });
          if (!result.ok) {
            return { status: "failed" as const, error: result.error };
          }

          const sendResult = await sendCustomerSetupInvite({
            userId: row.userId,
            name: row.name,
            email: row.email,
            organizationId: row.organizationId,
            flow: "set",
          });
          return {
            status: "created" as const,
            userId: row.userId,
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
