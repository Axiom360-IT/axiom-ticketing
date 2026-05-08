import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getActiveImpersonation, getSessionUser } from "@/lib/auth/session";
import { isPrivilegedUser } from "@/lib/auth/twofactor";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { ImpersonationBanner } from "@/components/shared/impersonation-banner";
import { Sidebar } from "@/components/shared/sidebar";
import { SkipLink } from "@/components/shared/skip-link";
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

  // Forced 2FA enrolment for privileged users (M17). When impersonating,
  // the real (signed-in) user is the one whose 2FA matters — they've
  // already passed this gate at sign-in, so we skip. For non-impersonated
  // sessions, anyone holding any PRIVILEGED_PERMISSIONS must be enrolled
  // before they can do anything in the dashboard.
  if (!user.isImpersonating && isPrivilegedUser(user)) {
    const [me] = await db
      .select({ twoFactorEnabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if (!me?.twoFactorEnabled) {
      redirect("/admin/2fa-required");
    }
  }

  // For the topbar: when impersonating, show the IMPERSONATED user's
  // name/email so the rest of the UI is consistent with `user.id`. The
  // banner above the topbar makes the override visible at a glance.
  const imp = await getActiveImpersonation();
  let displayEmail = session.user.email;
  let displayName = session.user.name;
  let bannerName: string | null = null;
  if (imp) {
    const [t] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, imp.targetId))
      .limit(1);
    if (t) {
      displayEmail = t.email;
      displayName = t.name;
      bannerName = t.name;
    }
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <SkipLink />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {bannerName ? <ImpersonationBanner targetName={bannerName} /> : null}
        <Topbar
          user={{
            id: user.id,
            email: displayEmail,
            name: displayName,
            roles: [...user.roleNames],
          }}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 p-6 overflow-y-auto focus:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
