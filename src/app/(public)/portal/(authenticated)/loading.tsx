import { Skeleton } from "@/components/ui/skeleton";

export default function PortalAuthedLoading() {
  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
