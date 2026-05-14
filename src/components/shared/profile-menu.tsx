"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { LogOut, User as UserIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/client";
import { initials } from "@/lib/format";

type ProfileMenuProps = {
  user: {
    name: string;
    email: string;
    roles: string[];
    /** Server-resolved signed URL for the avatar object, or null. */
    avatarUrl?: string | null;
  };
};

export function ProfileMenu({ user }: ProfileMenuProps) {
  const router = useRouter();
  const t = useTranslations("admin.shell");
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await authClient.signOut();
    setSigningOut(false);
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        aria-label={t("profileMenuLabel")}
      >
        <Avatar className="w-7 h-7">
          {user.avatarUrl ? (
            <AvatarImage src={user.avatarUrl} alt={user.name} />
          ) : null}
          <AvatarFallback className="text-xs">
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hidden sm:inline">
          {user.name}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="flex flex-col gap-0.5 px-1.5 py-1">
          <span className="text-sm font-medium">{user.name}</span>
          <span className="text-xs text-zinc-500 truncate">{user.email}</span>
          <span className="text-[10px] text-zinc-400 mt-1">
            {user.roles.length > 0
              ? user.roles.join(", ")
              : t("profileMenuNoRoles")}
          </span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/admin/profile" />}>
          <UserIcon className="w-4 h-4" aria-hidden="true" />
          <span>{t("profileMenuMyProfile")}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          disabled={signingOut}
          variant="destructive"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          <span>
            {signingOut ? t("profileMenuSigningOut") : t("profileMenuSignOut")}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
