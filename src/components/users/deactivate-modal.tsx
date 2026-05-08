"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type CascadeOption,
  deactivateUser,
} from "@/app/actions/users";

type ReassignCandidate = { id: string; name: string; email: string };

type Props = {
  userId: string;
  parentName: string | null;
  directChildrenCount: number;
  totalDescendantsCount: number;
  candidates: ReassignCandidate[];
};

export function DeactivateModal({
  userId,
  parentName,
  directChildrenCount,
  totalDescendantsCount,
  candidates,
}: Props) {
  const router = useRouter();
  const tDeactivate = useTranslations("users.deactivate");
  const tEdit = useTranslations("users.edit");
  const tCommon = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [option, setOption] = useState<CascadeOption>("move-up");
  const [reassignTo, setReassignTo] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (option === "reassign" && !reassignTo) {
      setError(tDeactivate("reassignTo"));
      return;
    }
    startTransition(async () => {
      try {
        const res = await deactivateUser(
          userId,
          option,
          option === "reassign" ? reassignTo : undefined,
        );
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : tDeactivate("genericError"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="destructive">{tEdit("deactivateButton")}</Button>}
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{tDeactivate("title")}</DialogTitle>
            <DialogDescription>{tDeactivate("description")}</DialogDescription>
          </DialogHeader>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {tDeactivate("directChildren", { count: directChildrenCount })}
            {" · "}
            {tDeactivate("totalDescendants", { count: totalDescendantsCount })}
          </p>

          <div className="space-y-2">
            <CascadeRadio
              value="move-up"
              checked={option === "move-up"}
              onChange={() => setOption("move-up")}
              label={
                parentName
                  ? tDeactivate("optionMoveUp", { parentName })
                  : tDeactivate("optionMoveUpNoParent")
              }
              disabled={isPending || directChildrenCount === 0}
            />
            <CascadeRadio
              value="cascade"
              checked={option === "cascade"}
              onChange={() => setOption("cascade")}
              label={tDeactivate("optionCascade", {
                count: totalDescendantsCount,
              })}
              disabled={isPending || totalDescendantsCount === 0}
            />
            <CascadeRadio
              value="reassign"
              checked={option === "reassign"}
              onChange={() => setOption("reassign")}
              label={tDeactivate("optionReassign")}
              disabled={isPending || directChildrenCount === 0}
            />
          </div>

          {option === "reassign" ? (
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-500 dark:text-zinc-400">
                {tDeactivate("reassignTo")}
              </label>
              <Select
                value={reassignTo}
                onValueChange={(v) => setReassignTo(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tDeactivate("reassignPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {tDeactivate("candidate", {
                        name: c.name,
                        email: c.email,
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400"
            >
              {error}
            </div>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {tCommon("cancel")}
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? tDeactivate("submitting") : tDeactivate("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CascadeRadio({
  value,
  checked,
  onChange,
  label,
  disabled,
}: {
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-2 text-sm cursor-pointer ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      }`}
    >
      <input
        type="radio"
        name="cascade"
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5"
      />
      <span>{label}</span>
    </label>
  );
}
