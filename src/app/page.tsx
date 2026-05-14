import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";

// Root landing. Customers are the default audience — anonymous visitors
// go to the customer sign-in (which itself links to "submit as guest"
// for people without an account). Already-signed-in users skip the
// sign-in step and land on whichever surface their role actually uses.
export default async function Home() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/portal/sign-in");
  }
  if (user.roleNames.has("Customer") && user.roleNames.size === 1) {
    redirect("/portal");
  }
  redirect("/admin");
}
