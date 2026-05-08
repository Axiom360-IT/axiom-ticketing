"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { LogOut, User as UserIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/client";

type ProfileMenuProps = {
  user: {
    name: string;
    email: string;
    roles: string[];
  };
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

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
          <AvatarFallback className="text-xs">
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hidden sm:inline">
          {user.name}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{user.name}</span>
            <span className="text-xs text-zinc-500 truncate">
              {user.email}
            </span>
            <span className="text-[10px] text-zinc-400 mt-1">
              {user.roles.length > 0
                ? user.roles.join(", ")
                : t("profileMenuNoRoles")}
            </span>
          </div>
        </DropdownMenuLabel>
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
