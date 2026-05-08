"use client";

import { useState } from "react";
import { ReauthModal } from "./reauth-modal";

// Wraps a Server Action call so that, if the action returns
// `{ reauthRequired: true }`, we pop the password modal, wait for the
// user to confirm, and re-run the action automatically. Returns the
// final action result either way.
//
// Usage in a client form:
//   const { runWithReauth, gate } = useReauthGate();
//   const res = await runWithReauth(() => updateSetting(k, v), "settings");
//   return (<><form>...</form>{gate}</>);

type ReauthAware = { ok: boolean; reauthRequired?: boolean };

export function useReauthGate() {
  const [pending, setPending] = useState<{
    resolve: (ok: boolean) => void;
    reasonKey: string;
  } | null>(null);

  async function runWithReauth<T extends ReauthAware>(
    action: () => Promise<T>,
    reasonKey: string = "default",
  ): Promise<T> {
    const first = await action();
    if (first.ok || !first.reauthRequired) return first;

    const verified = await new Promise<boolean>((resolve) => {
      setPending({ resolve, reasonKey });
    });
    if (!verified) return first;
    return await action();
  }

  const gate = (
    <ReauthModal
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && pending) {
          pending.resolve(false);
          setPending(null);
        }
      }}
      onVerified={() => {
        if (pending) {
          pending.resolve(true);
          setPending(null);
        }
      }}
      reasonKey={pending?.reasonKey ?? "default"}
    />
  );

  return { runWithReauth, gate };
}
