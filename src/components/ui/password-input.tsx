"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared password field with a show/hide eye toggle. Used on every surface
// that takes a password (sign-up, sign-in, change-password, re-auth, …) so the
// reveal affordance and its a11y wiring live in ONE place. Renders a plain
// <input> (not the design-system <Input>) so the customer-facing forms keep
// their existing taller input style; pass `className` to override.
const BASE_INPUT =
  "w-full px-3 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500";

type Props = Omit<React.ComponentProps<"input">, "type"> & {
  /** aria-label for the toggle when the password is hidden (e.g. "Show password"). */
  showLabel: string;
  /** aria-label for the toggle when the password is shown (e.g. "Hide password"). */
  hideLabel: string;
};

export function PasswordInput({
  showLabel,
  hideLabel,
  className,
  ...props
}: Props) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        type={show ? "text" : "password"}
        // Room for the toggle button on the right.
        className={cn(BASE_INPUT, "pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? hideLabel : showLabel}
        aria-pressed={show}
        // Keep the toggle out of the tab order — it's a convenience, and
        // tabbing should go straight from the field to the next control.
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        {show ? (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
