"use client";

/**
 * Filter chips — active = solid ink on paper text; inactive = bordered.
 * Touch targets ≥ 44px.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`min-h-11 cursor-pointer rounded-full px-3 font-sans text-xs font-semibold transition-colors ${
              active
                ? "bg-ink text-paper"
                : "border border-chip-border text-ink-80 hover:border-card-strong"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
