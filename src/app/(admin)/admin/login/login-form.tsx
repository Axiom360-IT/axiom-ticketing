"use client";

import { Eye, EyeOff } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useTranslations } from "next-intl";
import { signInWithLockout } from "@/app/actions/sign-in";

export function LoginForm() {
  const searchParams = useSearchParams();
  // Only accept same-origin admin paths so a phishing link with
  // `?from=https://evil.example` can't trick the post-login redirect. We also
  // refuse the auth pages themselves — sending the user back to /admin/login,
  // /admin/setup, or the (non-existent) /admin/sign-in after a successful
  // login is how a stray `from` turned into a post-login 404. Default to the
  // dashboard in any of those cases.
  const rawFrom = searchParams.get("from");
  const isSafeFrom =
    rawFrom != null &&
    (rawFrom === "/admin" || rawFrom.startsWith("/admin/")) &&
    !rawFrom.startsWith("/admin/login") &&
    !rawFrom.startsWith("/admin/setup") &&
    !rawFrom.startsWith("/admin/sign-in") &&
    !rawFrom.startsWith("/admin/signin");
  const fromPath = isSafeFrom ? rawFrom : "/admin";
  const t = useTranslations("admin.login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Trim defensively — autofill / paste often introduces stray whitespace.
    // The lockout action does the actual sign-in via Better Auth and sets
    // the session cookie via the nextCookies() plugin.
    const result = await signInWithLockout(
      email.trim(),
      password.trim(),
      rememberMe,
    );

    setLoading(false);

    if (!result.ok) {
      // Lockout + unverified messages come back from the server already
      // localized; for the bad-creds case we surface a generic error so
      // we never leak whether email or password was wrong.
      if ("locked" in result && result.locked) {
        setError(result.error);
      } else if ("unverified" in result && result.unverified) {
        setError(result.error);
      } else {
        setError(t("genericError"));
      }
      return;
    }

    // Hard navigation (not router.push + refresh): after the session cookie is
    // set, a full load guarantees the new cookie is sent and busts the client
    // router/prefetch cache — which avoids the intermittent post-login 404/blank
    // caused by a stale prefetch of the destination (fetched while logged out)
    // and the push+refresh race.
    window.location.assign(fromPath);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
        >
          {t("email")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
        >
          {t("password")}
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            minLength={12}
            className="w-full px-3 py-2 pr-10 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? t("hidePassword") : t("showPassword")}
            aria-pressed={showPassword}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {showPassword ? (
              <EyeOff size={18} aria-hidden="true" />
            ) : (
              <Eye size={18} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
        />
        {t("rememberMe")}
      </label>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-md px-3 py-2"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full px-4 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        {loading ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
