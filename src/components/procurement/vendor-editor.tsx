"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VendorSelect } from "@/components/procurement/vendor-select";
import { updateProcurementVendor } from "@/app/actions/procurement";

type Props = {
  requestId: string;
  vendor: string | null;
  /** Whether the caller can edit (procurement.manage, or their own request
   *  via procurement.update — resolved server-side). */
  canEdit: boolean;
};

export function VendorEditor({ requestId, vendor, canEdit }: Props) {
  const router = useRouter();
  const t = useTranslations("procurement.detail");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(vendor ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {vendor ?? <span className="text-zinc-400">{t("vendorNone")}</span>}
        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              setValue(vendor ?? "");
              setError(null);
              setEditing(true);
            }}
            title={t("editVendor")}
            aria-label={t("editVendor")}
            className="text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="w-56">
        <VendorSelect
          value={value}
          onChange={setValue}
          aria-label={t("editVendor")}
        />
        {error ? (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </div>
      <Button
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await updateProcurementVendor(requestId, value);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setEditing(false);
            router.refresh();
          });
        }}
      >
        {t("save")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => setEditing(false)}
      >
        {tCommon("cancel")}
      </Button>
    </div>
  );
}
