'use client';

import { ReactNode } from 'react';

interface LargeCTAButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'success' | 'danger';
  type?: 'button' | 'submit';
  className?: string;
}

/**
 * Prominent CTA button with glow effects and scale animation.
 * Use for primary page actions: Analyze, Submit, Continue.
 *
 * Variants:
 *   primary   — accent-blue bg + glow-blue
 *   success   — signal-buy green + glow-green
 *   danger    — signal-pass red + red glow
 *   secondary — terminal-surface bg + border, no glow
 */
export function LargeCTAButton({
  children,
  onClick,
  disabled = false,
  loading = false,
  variant = 'primary',
  type = 'button',
  className = '',
}: LargeCTAButtonProps) {
  const isDisabled = disabled || loading;

  const variantStyles = (): React.CSSProperties => {
    if (isDisabled) return { backgroundColor: 'var(--terminal-border)', color: 'var(--text-tertiary)' };
    switch (variant) {
      case 'primary':   return { backgroundColor: 'var(--accent-blue)',  color: 'white', boxShadow: 'var(--glow-blue)' };
      case 'success':   return { backgroundColor: 'var(--signal-buy)',   color: 'white', boxShadow: 'var(--glow-green)' };
      case 'danger':    return { backgroundColor: 'var(--signal-pass)',  color: 'white', boxShadow: '0 0 20px rgba(220,38,38,0.4)' };
      case 'secondary': return { backgroundColor: 'var(--terminal-surface)', color: 'var(--text-primary)', border: '2px solid var(--terminal-border-hover)' };
    }
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={`w-full h-14 text-lg font-bold rounded-lg transition-all flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] disabled:hover:scale-100 disabled:cursor-not-allowed ${className}`}
      style={variantStyles()}
    >
      {loading ? (
        <>
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span>Loading...</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
