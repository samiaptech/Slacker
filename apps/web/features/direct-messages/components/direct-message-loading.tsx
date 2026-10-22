import type { ReactElement } from "react";
import { Skeleton } from "@workspace/ui/primitives";

export const DirectMessageLoading = (): ReactElement => (
  <section aria-label="Loading direct message" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-[#fbfaf8]" role="status">
    <span className="sr-only">Opening direct conversation…</span>
    <header className="flex h-12 shrink-0 items-center justify-end border-b border-[#e9e7e1] px-6 sm:px-8">
      <Skeleton className="h-3 w-28 rounded-full" />
    </header>
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden px-6 py-6 sm:px-8">
      <div className="mt-2 flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-4 w-4/5" /></div>
      </div>
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-4 w-3/5" /></div>
      </div>
      <div className="flex items-start justify-end gap-3">
        <div className="flex w-3/5 flex-col items-end gap-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-12 w-full rounded-2xl" /></div>
        <Skeleton className="size-9 shrink-0 rounded-full" />
      </div>
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-2/3" /></div>
      </div>
    </div>
    <div aria-hidden="true" className="shrink-0 border-t border-[#e9e7e1] bg-white/75 px-6 py-4 sm:px-8">
      <Skeleton className="h-16 w-full rounded-2xl" />
    </div>
  </section>
);
