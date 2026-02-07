'use client';

export function TokenCounter({
  selectedEntries,
  includeCanvas,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  streamId: _streamId,
}: {
  selectedEntries: string[];
  includeCanvas: boolean;
  streamId: string;
}) {
  // TODO: Calculate real tokens
  const estimatedTokens = (selectedEntries.length * 200) + (includeCanvas ? 1000 : 0);

  return (
    <div className="mb-4 text-sm text-gray-500">
      Estimated Tokens: {estimatedTokens}
    </div>
  );
}
