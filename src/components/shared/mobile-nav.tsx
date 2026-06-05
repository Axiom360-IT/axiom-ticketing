"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BrandingConfig } from "@/lib/branding/presets";
import type { Permission } from "@/lib/auth/permissions";
import { SidebarContent } from "./sidebar-content";

/**
 * Mobile admin navigation — a hamburger (shown only below `md`, where the
 * desktop `Sidebar` is hidden) that opens the nav as a slide-in drawer. Built
 * on the Base-UI Dialog primitive, so it gets focus trap + focus return,
 * scroll lock, a non-focusable backdrop, `aria-controls`/`aria-modal`, and a
 * portal to <body> (which lifts it out of the topbar's z-10 stacking context)
 * for free. Closes on backdrop tap, the X, Escape, or tapping a link.
 */
export function MobileNav({
  branding,
  permissions,
}: {
  branding: BrandingConfig;
  permissions: Permission[];
}) {
  const t = useTranslations("admin.shell");
  const [open, setOpen] = useState(false);

  // If the viewport grows to desktop while the drawer is open, close it — the
  // desktop sidebar takes over and we don't want a modal lingering (scroll
  // lock / focus trap) behind an `md:hidden` panel.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={
          <button
            type="button"
            aria-label={t("openMenu")}
            className="md:hidden -ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          />
        }
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 md:hidden data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Popup className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[82%] flex-col bg-slate-900 text-slate-100 shadow-xl outline-none md:hidden data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left">
          <Dialog.Title className="sr-only">{t("mainNavLabel")}</Dialog.Title>
          <Dialog.Close
            render={
              <button
                type="button"
                aria-label={t("closeMenu")}
                className="absolute right-2 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
              />
            }
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Dialog.Close>
          <SidebarContent
            branding={branding}
            permissions={permissions}
            onNavigate={() => setOpen(false)}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
