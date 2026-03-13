"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const message =
    error?.message?.trim() || "Something went wrong while loading this stream.";

  return (
    <div className="flex flex-1 items-center justify-center bg-surface-subtle px-6 py-10">
      <div className="w-full max-w-md rounded-xl border border-status-error-border bg-status-error-bg p-6 text-center text-status-error-text">
        <h1 className="text-lg font-semibold text-text-default">
          Stream failed to load
        </h1>
        <p className="mt-2 text-sm text-status-error-text">{message}</p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 inline-flex items-center justify-center rounded-sm border border-status-error-border bg-surface-default px-4 py-2 text-xs font-semibold text-status-error-text transition hover:bg-surface-subtle"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
