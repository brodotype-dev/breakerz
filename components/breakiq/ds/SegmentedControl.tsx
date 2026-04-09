'use client';

import { ReactNode } from 'react';

interface SegmentOption {
  value: string;
  label: ReactNode;
}

interface SegmentedControlProps {
  options: SegmentOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Button group for mutually exclusive options.
 * Active option gets accent-blue background with glow.
 * Use for 2–5 options: break type, view mode, filters.
 */
export function SegmentedControl({ options, value, onChange, className = '' }: SegmentedControlProps) {
  return (
    <div
      className={`flex gap-1 rounded-lg p-1.5 border ${className}`}
      style={{
        backgroundColor: 'var(--terminal-bg)',
        borderColor: 'var(--terminal-border)',
      }}
    >
      {options.map(option => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className="flex-1 px-3 py-2.5 text-sm font-semibold rounded-md transition-all"
            style={{
              backgroundColor: isActive ? 'var(--accent-blue)' : 'transparent',
              color: isActive ? 'white' : 'var(--text-secondary)',
              boxShadow: isActive ? 'var(--glow-blue)' : 'none',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
