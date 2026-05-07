import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";

export default async function AdminLanding() {
  // Layout already enforced session; getSessionUser() will be set.
  const user = await getSessionUser();

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-2">Welcome</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          You&apos;re signed in. The admin shell is in place. Ticketing UI
          lands in M3.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session</CardTitle>
          <CardDescription>What this account can do right now.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="font-medium">User ID:</span>{" "}
            <code className="font-mono text-xs">{user?.id}</code>
          </div>
          <div>
            <span className="font-medium">Roles:</span>{" "}
            {user ? [...user.roleNames].join(", ") || "(none)" : "(none)"}
          </div>
          <div>
            <span className="font-medium">Permissions:</span>{" "}
            <span className="text-zinc-500">
              {user?.permissions.size ?? 0} active
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
