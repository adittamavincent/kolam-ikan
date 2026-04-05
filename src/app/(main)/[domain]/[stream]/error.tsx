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
    <div className="flex flex-1 items-center justify-center bg-slate-50 px-6 py-10">
      <div className="w-full max-w-md border border-slate-300 bg-rose-100 p-6 text-center text-rose-700">
        <h1 className="font-semibold text-slate-800">
          Stream failed to load
        </h1>
        <p className="mt-2 text-rose-700">{message}</p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 inline-flex items-center justify-center border border-slate-300 bg-white px-4 py-2 font-semibold text-rose-700 transition hover:bg-slate-50"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
