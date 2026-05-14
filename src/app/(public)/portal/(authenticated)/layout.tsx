import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { CustomerTopbar } from "@/components/customer/customer-topbar";
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

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <CustomerTopbar
        email={profile?.email ?? ""}
        name={profile?.name ?? ""}
        avatarUrl={avatarUrl}
      />
      <div className="flex-1">{children}</div>
    </div>
  );
}
