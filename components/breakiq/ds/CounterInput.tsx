'use client';

interface CounterInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

/**
 * Numeric stepper with animated +/- buttons.
 * Use for case counts and other bounded numeric inputs.
 */
export function CounterInput({ value, onChange, min = 1, max, className = '' }: CounterInputProps) {
  const decrement = () => { if (min === undefined || value > min) onChange(value - 1); };
  const increment = () => { if (max === undefined || value < max) onChange(value + 1); };

  return (
    <div
      className={`flex gap-3 rounded-lg px-4 py-2.5 border justify-center items-center ${className}`}
      style={{ backgroundColor: 'var(--terminal-bg)', borderColor: 'var(--terminal-border)' }}
    >
      <button
        onClick={decrement}
        disabled={min !== undefined && value <= min}
        className="font-mono font-bold text-xl hover:scale-125 transition-transform disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100"
        style={{ color: 'var(--accent-blue)' }}
      >
        −
      </button>
      <span
        className="font-mono font-bold text-2xl min-w-[3ch] text-center"
        style={{ color: 'var(--text-primary)' }}
      >
        {value}
      </span>
      <button
        onClick={increment}
        disabled={max !== undefined && value >= max}
        className="font-mono font-bold text-xl hover:scale-125 transition-transform disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100"
        style={{ color: 'var(--accent-blue)' }}
      >
        +
      </button>
    </div>
  );
}
