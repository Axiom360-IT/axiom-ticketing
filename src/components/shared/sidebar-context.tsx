"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Shared collapse state for the desktop admin sidebar. Lives in a context so
// the toggle can sit in the topbar (a sibling of the sidebar in the layout
// tree) while the sidebar itself reads the same state to set its width and
// render icons-only. Persisted to localStorage so the preference sticks.

const MINI_STORAGE_KEY = "axiom.sidebar.mini";

type SidebarContextValue = {
  /** Collapsed to the icon rail. */
  mini: boolean;
  toggle: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // Start expanded so the server and first client render agree; the persisted
  // preference is applied after mount.
  const [mini, setMini] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(MINI_STORAGE_KEY) === "1") setMini(true);
    } catch {
      // Storage unavailable — just stay expanded.
    }
  }, []);

  const toggle = () =>
    setMini((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MINI_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore — preference simply won't persist.
      }
      return next;
    });

  return (
    <SidebarContext.Provider value={{ mini, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return ctx;
}
