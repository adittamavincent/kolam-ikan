'use client';

export function ContextBag({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  streamId: _streamId,
  selectedEntries,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onSelectionChange: _onSelectionChange,
  includeCanvas,
  onIncludeCanvasChange,
}: {
  streamId: string;
  selectedEntries: string[];
  onSelectionChange: (ids: string[]) => void;
  includeCanvas: boolean;
  onIncludeCanvasChange: (include: boolean) => void;
}) {
  return (
    <div className="mb-4 rounded border border-gray-200 p-4">
      <h3 className="mb-2 font-medium">Context Bag</h3>
      <div className="space-y-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeCanvas}
            onChange={(e) => onIncludeCanvasChange(e.target.checked)}
          />
          Include Current Canvas
        </label>
        {/* TODO: List entries to select */}
        <p className="text-sm text-gray-500">
          {selectedEntries.length} entries selected
        </p>
      </div>
    </div>
  );
}
