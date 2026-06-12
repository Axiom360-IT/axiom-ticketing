"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RowActionIcons } from "@/components/ui/row-actions";
import { permissionLabel } from "@/lib/auth/permission-label";
import { deleteRole, getRoleDetail, updateRole } from "@/app/actions/roles";

export type RoleRowSummary = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
};

type Props = {
  role: RoleRowSummary;
  canEdit: boolean;
  canDelete: boolean;
};

type RoleDetail = Awaited<ReturnType<typeof getRoleDetail>>;

export function RoleRowActions({ role, canEdit, canDelete }: Props) {
  const t = useTranslations("common");
  const tDialog = useTranslations("roles.rowActions");
  const tList = useTranslations("roles.list");
  // Permission strings (`tickets.view`) are not user copy. The same i18n
  // bundle that powers the matrix labels (`roles.matrix.label.<key>`)
  // is reused here so the View dialog shows "View tickets" instead of
  // the raw dotted constant. Dotted prefix is escaped to `__` because
  // i18n keys can't contain dots.
  const tPermLabel = useTranslations("roles.matrix.label") as unknown as (
    key: string,
  ) => string;
  const router = useRouter();

  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const [detail, setDetail] = useState<RoleDetail>(null);
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Lazy-load permissions when the View modal opens.
  useEffect(() => {
    if (!viewOpen || detail) return;
    let cancelled = false;
    void getRoleDetail(role.id).then((d) => {
      if (!cancelled) setDetail(d);
    });
    return () => {
      cancelled = true;
    };
  }, [viewOpen, detail, role.id]);

  const showRemove = canDelete && !role.isSystem && role.userCount === 0;

  function submitEdit() {
    setError(null);
    startTransition(async () => {
      const result = await updateRole(role.id, {
        name,
        description: description.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditOpen(false);
      router.refresh();
    });
  }

  function submitRemove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteRole(role.id);
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
        ariaLabelPrefix={role.name}
        view={() => setViewOpen(true)}
        edit={canEdit && !role.isSystem ? () => setEditOpen(true) : undefined}
        remove={showRemove ? { onClick: () => setRemoveOpen(true) } : undefined}
      />

      {/* ── View modal ─────────────────────────────────────── */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {role.name}
              {role.isSystem ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                  {tList("system")}
                </span>
              ) : null}
            </DialogTitle>
            {role.description ? (
              <DialogDescription className="text-foreground text-sm">
                {role.description}
              </DialogDescription>
            ) : null}
          </DialogHeader>

          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tList("columns.users")}
            </dt>
            <dd>{tList("userCount", { count: role.userCount })}</dd>
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tDialog("permissionsLabel")}
            </dt>
            <dd>
              {!detail ? (
                <span className="text-xs text-zinc-400">{t("loading")}</span>
              ) : detail.permissions.length === 0 ? (
                <span className="text-xs text-zinc-400">
                  {tDialog("noPermissions")}
                </span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {detail.permissions.map((p) => (
                    <span
                      key={p}
                      className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900"
                    >
                      {permissionLabel(p, tPermLabel)}
                    </span>
                  ))}
                </div>
              )}
            </dd>
          </dl>

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewOpen(false)}>
              {t("close")}
            </Button>
            <Button
              nativeButton={false}
              render={<Link href={`/admin/roles/${role.id}`} />}
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              {tDialog("openFullRole")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit modal (name + description; permissions on full editor) ── */}
      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            setName(role.name);
            setDescription(role.description ?? "");
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tDialog("editTitle", { role: role.name })}</DialogTitle>
            <DialogDescription>{tDialog("editDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-zinc-600 dark:text-zinc-400">
                {tList("columns.name")}
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={pending}
                maxLength={80}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-600 dark:text-zinc-400">
                {tList("columns.description")}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={pending}
                maxLength={500}
                rows={3}
                className="w-full px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {error ? (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : null}
            <p className="text-xs text-zinc-500 dark:text-zinc-400 pt-1">
              {tDialog("editHint")}{" "}
              <Link
                href={`/admin/roles/${role.id}`}
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                {tDialog("openFullRole")}
              </Link>
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button onClick={submitEdit} disabled={pending}>
              {pending ? tDialog("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm modal ──────────────────────────── */}
      <Dialog
        open={removeOpen}
        onOpenChange={(open) => {
          setRemoveOpen(open);
          if (!open) setError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tDialog("deleteTitle", { role: role.name })}</DialogTitle>
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
            <Button variant="destructive" onClick={submitRemove} disabled={pending}>
              {pending ? tDialog("deleting") : t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
