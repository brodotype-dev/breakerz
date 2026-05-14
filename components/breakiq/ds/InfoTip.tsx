'use client';

// Small inline "?" icon with a hover/focus tooltip. Designed for first-mention
// glossing of trader vocabulary ("Format mix", "EV Mid", etc.) on consumer
// surfaces. CSS-only hover via `group` — no JS state needed.
//
// Usage:
//   <FormLabel>Format mix <InfoTip text="How many cases of each break type." /></FormLabel>

export interface InfoTipProps {
  text: string;
  /** Optional position override. Default 'bottom'. */
  placement?: 'top' | 'bottom';
}

export function InfoTip({ text, placement = 'bottom' }: InfoTipProps) {
  const positionClass =
    placement === 'top'
      ? 'bottom-full left-0 mb-1'
      : 'top-full left-0 mt-1';

  return (
    <span className="relative group inline-flex items-center align-middle ml-1">
      <button
        type="button"
        tabIndex={0}
        aria-label={text}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold leading-none transition-colors"
        style={{
          color: 'var(--text-tertiary)',
          border: '1px solid var(--terminal-border)',
          backgroundColor: 'transparent',
        }}
      >
        ?
      </button>
      <span
        role="tooltip"
        className={`absolute ${positionClass} z-30 w-56 rounded-md px-2.5 py-1.5 text-[11px] leading-snug font-normal normal-case tracking-normal shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity`}
        style={{
          backgroundColor: 'var(--terminal-bg)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--terminal-border-hover)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}
      >
        {text}
      </span>
    </span>
  );
}
