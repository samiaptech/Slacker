import type { ReactElement } from "react";
import { Skeleton } from "@workspace/ui/primitives";

const WorkspacePageLoading = (): ReactElement => (
  <div aria-label="Loading conversation" className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden p-4 sm:p-6" role="status">
    <span className="sr-only">Loading conversation…</span>
    <Skeleton className="h-10 w-full rounded-xl" />
    <div className="mt-2 flex items-start gap-3">
      <Skeleton className="size-9 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
    <div className="flex items-start gap-3">
      <Skeleton className="size-9 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    </div>
    <div className="mt-auto">
      <Skeleton className="h-16 w-full rounded-2xl" />
    </div>
  </div>
);

export default WorkspacePageLoading;
