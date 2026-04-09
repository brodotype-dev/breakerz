import { ReactNode } from 'react';

interface ElevatedCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * High-contrast card with thick borders and deep shadow.
 * Use for forms, configuration panels, and important content sections.
 */
export function ElevatedCard({ children, className = '' }: ElevatedCardProps) {
  return (
    <div
      className={`rounded-xl border-2 p-6 ${className}`}
      style={{
        backgroundColor: 'var(--terminal-surface)',
        borderColor: 'var(--terminal-border-hover)',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
      }}
    >
      {children}
    </div>
  );
}
