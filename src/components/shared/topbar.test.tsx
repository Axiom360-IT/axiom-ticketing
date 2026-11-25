import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Topbar is an async server component. Its children are stubbed: this suite
// is only about what it does when the notification query fails.
vi.mock("@/app/actions/notifications", () => ({
  getRecentNotifications: vi.fn(),
}));
vi.mock("./global-search", () => ({ GlobalSearch: () => null }));
vi.mock("./mobile-nav", () => ({ MobileNav: () => null }));
vi.mock("./notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("./profile-menu", () => ({ ProfileMenu: () => null }));
vi.mock("./sidebar-toggle", () => ({ SidebarToggle: () => null }));
vi.mock("./theme-toggle-server", () => ({ ThemeToggleServer: () => null }));

import { getRecentNotifications } from "@/app/actions/notifications";
import { DEFAULT_BRANDING } from "@/lib/branding/presets";
import { NotificationBell } from "./notification-bell";
import { Topbar } from "./topbar";

// Walks a React element tree (no rendering) and returns the first element of `type`.
function find(node: ReactNode, type: unknown): ReactElement | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n, type);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === type) return el;
  return find(el.props?.children, type);
}

const props = {
  user: { id: "u1", email: "a@b.c", name: "A", roles: [] as string[] },
  branding: DEFAULT_BRANDING,
  permissions: [],
  ticketTypes: [],
};

describe("Topbar", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hands the bell the loaded notifications when the query works", async () => {
    const loaded = { unreadCount: 3, items: [] };
    vi.mocked(getRecentNotifications).mockResolvedValue(loaded);

    const tree = await Topbar(props);

    expect(find(tree, NotificationBell)?.props).toMatchObject({ initial: loaded });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("still renders when the notification query fails, with an empty bell and a log line", async () => {
    vi.mocked(getRecentNotifications).mockRejectedValue(new Error("db down"));

    const tree = await Topbar(props);

    // The page loads; the bell starts empty (it polls and recovers on its own).
    expect(find(tree, NotificationBell)?.props).toMatchObject({
      initial: { unreadCount: 0, items: [] },
    });
    expect(console.error).toHaveBeenCalledWith(
      "[topbar] could not load notifications",
      expect.any(Error),
    );
  });
});
