import { Skeleton } from "@/components/ui/skeleton";

export default function PortalTicketDetailLoading() {
  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
