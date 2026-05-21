import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { CustomerSidebar } from "@/components/customer/customer-sidebar";
import { CustomerTopbar } from "@/components/customer/customer-topbar";
import { getRecentNotifications } from "@/app/actions/notifications";
import { loadBranding } from "@/lib/branding/load";
import { getAvatarSignedUrl } from "@/lib/storage/signed-urls";

export default async function PortalAuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/portal/sign-in");
  if (!user.roleNames.has("Customer")) redirect("/admin");

  const [profile] = await db
    .select({ name: users.name, email: users.email, image: users.image })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  // image stores the R2 storage key; sign with 1h TTL for browser caching.
  const avatarUrl = profile?.image
    ? await getAvatarSignedUrl(profile.image)
    : null;
  const branding = await loadBranding();
  const initialNotifs = await getRecentNotifications();

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <CustomerSidebar branding={branding} />
      <div className="flex-1 flex flex-col min-w-0">
        <CustomerTopbar
          email={profile?.email ?? ""}
          name={profile?.name ?? ""}
          avatarUrl={avatarUrl}
          initialNotifications={initialNotifs}
        />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
