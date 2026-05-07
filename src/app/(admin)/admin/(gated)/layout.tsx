import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getSessionUser } from "@/lib/auth/session";
import { Sidebar } from "@/components/shared/sidebar";
import { Topbar } from "@/components/shared/topbar";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export default async function AdminGatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerList = await headers();

  // Resolve full session (DB lookup) — middleware already short-circuited
  // requests with no cookie at all.
  const session = await auth.api.getSession({ headers: headerList });
  if (!session?.user) {
    redirect("/admin/login");
  }

  // 12-hour idle timeout for /admin/* per ARCHITECTURE §6
  const lastActive = new Date(session.session.updatedAt).getTime();
  if (Date.now() - lastActive > TWELVE_HOURS_MS) {
    redirect("/admin/login?from=/admin&reason=session_expired");
  }

  const user = await getSessionUser();
  if (!user) {
    redirect("/admin/login");
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          user={{
            id: user.id,
            email: session.user.email,
            name: session.user.name,
            roles: [...user.roleNames],
          }}
        />
        <main className="flex-1 p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
