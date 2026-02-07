'use client';

export function PersonaSelector({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="mb-4">
      <label className="mb-1 block text-sm font-medium text-gray-700">Select Persona</label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded border border-gray-300 p-2"
      >
        <option value="">Select a persona...</option>
        {/* TODO: Fetch personas */}
        <option value="persona-1">Default Persona</option>
      </select>
    </div>
  );
}
