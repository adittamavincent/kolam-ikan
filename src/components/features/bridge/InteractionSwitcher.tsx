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
              ? 'bg-action-primary-bg text-action-primary-text'
              : 'bg-surface-subtle text-text-default hover:bg-surface-hover'
          }`}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}
