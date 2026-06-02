"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RowActionIcons } from "@/components/ui/row-actions";
import { deleteOrganization } from "@/app/actions/organizations";

export type OrgRowSummary = {
  id: string;
  name: string;
};

type Props = {
  organization: OrgRowSummary;
  canEdit: boolean;
  canDelete: boolean;
};

export function OrgRowActions({ organization, canEdit, canDelete }: Props) {
  const t = useTranslations("common");
  const tDialog = useTranslations("organizations.rowActions");
  const router = useRouter();

  const [removeOpen, setRemoveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submitRemove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteOrganization(organization.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRemoveOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <RowActionIcons
        ariaLabelPrefix={organization.name}
        edit={
          canEdit
            ? () => router.push(`/admin/organizations/${organization.id}`)
            : undefined
        }
        remove={
          canDelete ? { onClick: () => setRemoveOpen(true) } : undefined
        }
      />

      <Dialog
        open={removeOpen}
        onOpenChange={(open) => {
          setRemoveOpen(open);
          if (!open) setError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tDialog("deleteTitle", { name: organization.name })}
            </DialogTitle>
            <DialogDescription>
              {tDialog("deleteDescription")}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoveOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={submitRemove}
              disabled={pending}
            >
              {pending ? tDialog("deleting") : t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
