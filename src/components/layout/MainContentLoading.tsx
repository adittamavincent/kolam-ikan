"use client";

function SkeletonBlock({
  className,
}: {
  className: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-surface-elevated ${className}`}
    />
  );
}

interface MainContentLoadingProps {
  title: string;
  hint: string;
  mode?: "domain" | "stream";
}

export function MainContentLoading({
  title,
  hint,
  mode = "domain",
}: MainContentLoadingProps) {
  return (
    <div className="flex flex-1 overflow-hidden bg-surface-subtle">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border-default bg-surface-default px-6 py-4">
          <div className="flex items-center gap-3">
            <SkeletonBlock className="h-9 w-9 rounded-full" />
            <div className="space-y-2">
              <SkeletonBlock className="h-4 w-40" />
              <SkeletonBlock className="h-3 w-56" />
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-hidden px-6 py-5">
          <div className="border border-border-default bg-surface-default/70 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-text-default">
                  {title}
                </p>
                <p className="mt-1 text-xs text-text-muted">{hint}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span className="h-2 w-2 animate-pulse rounded-full bg-action-primary-bg" />
                <span>Loading</span>
              </div>
            </div>
          </div>

          {mode === "stream" ? (
            <div className="flex min-h-0 flex-1 gap-4">
              <div className="flex min-h-0 flex-[1.05] flex-col border border-border-default bg-surface-default/70">
                <div className="border-b border-border-default px-4 py-3">
                  <SkeletonBlock className="h-4 w-28" />
                </div>
                <div className="space-y-4 px-4 py-4">
                  <SkeletonBlock className="h-16 w-full" />
                  <SkeletonBlock className="h-24 w-5/6" />
                  <SkeletonBlock className="h-20 w-full" />
                  <SkeletonBlock className="h-14 w-3/4" />
                </div>
              </div>

              <div className="hidden min-h-0 flex-1 flex-col border border-border-default bg-surface-default/70 lg:flex">
                <div className="border-b border-border-default px-4 py-3">
                  <SkeletonBlock className="h-4 w-24" />
                </div>
                <div className="space-y-4 px-4 py-4">
                  <SkeletonBlock className="h-8 w-1/3" />
                  <SkeletonBlock className="h-32 w-full" />
                  <SkeletonBlock className="h-32 w-full" />
                  <SkeletonBlock className="h-12 w-2/3" />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center border border-dashed border-border-default bg-surface-default/40 px-6 py-12">
              <div className="w-full max-w-xl space-y-4">
                <SkeletonBlock className="mx-auto h-5 w-44" />
                <SkeletonBlock className="mx-auto h-3 w-72" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <SkeletonBlock className="h-24 w-full" />
                  <SkeletonBlock className="h-24 w-full" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
