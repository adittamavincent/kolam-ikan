"use client";

function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-slate-100 ${className}`}
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
    <div className="flex flex-1 overflow-hidden bg-slate-50">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-slate-300 bg-white px-6 py-4">
          <div className="flex items-center gap-3">
            <SkeletonBlock className="h-9 w-9 rounded-none" />
            <div className="space-y-2">
              <SkeletonBlock className="h-4 w-40" />
              <SkeletonBlock className="h-3 w-56" />
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-hidden px-6 py-5">
          <div className="border border-slate-300 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-800">{title}</p>
                <p className="mt-1 text-slate-500">{hint}</p>
              </div>
              <div className="flex items-center gap-2 text-slate-500">
                <span className="h-2 w-2 animate-pulse rounded-none bg-blue-500" />
                <span>Loading</span>
              </div>
            </div>
          </div>

          {mode === "stream" ? (
            <div className="flex min-h-0 flex-1 gap-4">
              <div className="flex min-h-0 flex-[1.05] flex-col border border-slate-300 bg-white">
                <div className="border-b border-slate-300 px-4 py-3">
                  <SkeletonBlock className="h-4 w-28" />
                </div>
                <div className="space-y-4 px-4 py-4">
                  <SkeletonBlock className="h-16 w-full" />
                  <SkeletonBlock className="h-24 w-5/6" />
                  <SkeletonBlock className="h-20 w-full" />
                  <SkeletonBlock className="h-14 w-3/4" />
                </div>
              </div>

              <div className="hidden min-h-0 flex-1 flex-col border border-slate-300 bg-white lg:flex">
                <div className="border-b border-slate-300 px-4 py-3">
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
            <div className="flex flex-1 items-center justify-center border border-dashed border-slate-300 bg-slate-50 px-6 py-12">
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
