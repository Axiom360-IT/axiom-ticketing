"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createMyMcpToken,
  revokeMyMcpToken,
} from "@/app/actions/mcp-tokens";
import type { McpTokenSummary } from "@/lib/auth/mcp-tokens";

type Props = {
  initial: McpTokenSummary[];
  mcpUrl: string;
};

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 truncate rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-900">
        {value}
      </code>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}

export function McpTokensList({ initial, mcpUrl }: Props) {
  const router = useRouter();
  const t = useTranslations("profile.mcp");
  const formatter = useFormatter();

  const [items, setItems] = useState<McpTokenSummary[]>(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createMyMcpToken(label);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNewToken(res.token);
      setLabel("");
      router.refresh();
    });
  }

  function handleRevoke(id: string) {
    startTransition(async () => {
      const res = await revokeMyMcpToken(id);
      if (res.ok) {
        setItems((prev) => prev.filter((tkn) => tkn.id !== id));
        router.refresh();
      }
    });
  }

  function closeDialog(open: boolean) {
    setDialogOpen(open);
    if (!open) setNewToken(null);
  }

  const active = items.filter((tkn) => !tkn.revokedAt);

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {t("serverUrlLabel")}
      </p>
      <CopyField value={mcpUrl} />

      {active.length > 0 ? (
        <ul className="space-y-2">
          {active.map((tkn) => (
            <li
              key={tkn.id}
              className="flex items-start gap-3 px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{tkn.label}</div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t("created", {
                    when: formatter.dateTime(tkn.createdAt, { dateStyle: "medium" }),
                  })}
                  {tkn.lastUsedAt
                    ? ` · ${t("lastUsed", {
                        when: formatter.relativeTime(tkn.lastUsedAt, { now: new Date() }),
                      })}`
                    : ` · ${t("neverUsed")}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleRevoke(tkn.id)}
                disabled={isPending}
              >
                {t("revokeButton")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
      )}

      <Dialog open={dialogOpen} onOpenChange={closeDialog}>
        <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
          {t("generateButton")}
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          {newToken ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("revealTitle")}</DialogTitle>
                <DialogDescription>{t("revealDescription")}</DialogDescription>
              </DialogHeader>
              <div className="py-3">
                <CopyField value={newToken} />
              </div>
              <DialogFooter>
                <DialogClose render={<Button type="button" />}>
                  {t("doneButton")}
                </DialogClose>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>{t("generateTitle")}</DialogTitle>
                <DialogDescription>{t("generateDescription")}</DialogDescription>
              </DialogHeader>
              <div className="py-3 space-y-1.5">
                <Label htmlFor="mcp-token-label">{t("labelField")}</Label>
                <Input
                  id="mcp-token-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={t("labelPlaceholder")}
                  maxLength={80}
                  required
                  autoFocus
                />
                {error ? (
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                ) : null}
              </div>
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" />}>
                  {t("cancel")}
                </DialogClose>
                <Button type="submit" disabled={isPending || !label.trim()}>
                  {isPending ? t("generating") : t("generateButton")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
