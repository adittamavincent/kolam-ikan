'use client';

export function InteractionSwitcher({
  value,
  onChange,
}: {
  value: 'ASK' | 'GO' | 'BOTH';
  onChange: (value: 'ASK' | 'GO' | 'BOTH') => void;
}) {
  return (
    <div className="mb-4 flex gap-2">
      {(['ASK', 'GO', 'BOTH'] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          className={`rounded px-4 py-2 ${
            value === mode
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}
