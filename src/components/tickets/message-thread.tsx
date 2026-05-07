import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type ThreadMessage = {
  id: string;
  authorName: string;
  authorEmail: string;
  authorType: "agent" | "customer" | "system";
  body: string;
  channel: string;
  isInternalNote: boolean;
  isResolutionNote: boolean;
  createdAt: Date;
};

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  portal: "Portal",
  dashboard: "Dashboard",
  system: "System",
};

export function MessageThread({ messages }: { messages: ThreadMessage[] }) {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No messages yet.
      </p>
    );
  }

  return (
    <ol className="space-y-4">
      {messages.map((m) => (
        <li
          key={m.id}
          className={cn(
            "rounded-lg border p-4",
            m.isResolutionNote &&
              "border-green-200 bg-green-50/40 dark:border-green-900 dark:bg-green-950/30",
            m.isInternalNote &&
              "border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/30",
            !m.isInternalNote &&
              !m.isResolutionNote &&
              "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950",
          )}
        >
          <div className="flex items-start gap-3">
            <Avatar className="size-8 shrink-0">
              <AvatarFallback className="text-xs">
                {initials(m.authorName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{m.authorName}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {m.authorType === "customer"
                    ? "Customer"
                    : m.authorType === "agent"
                      ? "Agent"
                      : "System"}
                </span>
                <span className="text-xs text-zinc-400">·</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {CHANNEL_LABEL[m.channel] ?? m.channel}
                </span>
                {m.isResolutionNote ? (
                  <span className="text-xs font-medium text-green-700 dark:text-green-400">
                    · Resolution note
                  </span>
                ) : null}
                {m.isInternalNote ? (
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    · Internal note
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-zinc-400">
                  {formatTimestamp(m.createdAt)}
                </span>
              </div>
              <div className="mt-2 text-sm whitespace-pre-wrap break-words">
                {m.body}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function formatTimestamp(d: Date): string {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
