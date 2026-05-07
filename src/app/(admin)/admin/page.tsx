import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";

export default async function AdminLanding() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/admin/login");
  }

  // Minimal landing for M1 verification. M2 replaces this with the full
  // admin shell and redirects to /admin/tickets.
  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Welcome</h1>
      <p className="text-zinc-600 dark:text-zinc-400 mb-8">
        You&apos;re signed in. The admin shell ships in M2.
      </p>

      <section className="space-y-4 text-sm">
        <div>
          <span className="font-medium">User ID:</span>{" "}
          <code className="font-mono text-xs">{user.id}</code>
        </div>
        <div>
          <span className="font-medium">Roles:</span>{" "}
          {[...user.roleNames].join(", ") || "(none)"}
        </div>
        <div>
          <span className="font-medium">Permissions:</span>{" "}
          <span className="text-zinc-500">
            {user.permissions.size} active
          </span>
        </div>
      </section>
    </main>
  );
}
