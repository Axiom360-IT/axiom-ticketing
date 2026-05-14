import { Skeleton } from "@/components/ui/skeleton";

// Streamed fallback while a gated admin page resolves. Mirrors the rough
// shape of the page content (header strip + a stack of card-sized rows)
// so the layout doesn't jump when content arrives.

export default function AdminGatedLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
