'use client';

import { cn } from '@/lib/utils';
import type { Signal } from '@/lib/types';

interface Props {
  signal: Signal;
  size?: 'sm' | 'md' | 'lg';
  valuePct?: number;
  className?: string;
}

const STYLES: Record<Signal, { color: string; bg: string; border: string }> = {
  BUY:   { color: 'var(--signal-buy)',   bg: 'var(--signal-buy-bg)',   border: 'var(--signal-buy-border)' },
  WATCH: { color: 'var(--signal-watch)', bg: 'var(--signal-watch-bg)', border: 'var(--signal-watch-border)' },
  PASS:  { color: 'var(--signal-pass)',  bg: 'var(--signal-pass-bg)',  border: 'var(--signal-pass-border)' },
};

const SIZES = {
  sm: 'text-[10px] px-1.5 py-0.5',
  md: 'text-xs px-2 py-1',
  lg: 'text-sm px-3 py-1.5',
};

export default function SignalBadge({ signal, size = 'md', valuePct, className }: Props) {
  const s = STYLES[signal];
  return (
    <span
      className={cn('inline-flex items-center gap-1 font-mono font-semibold rounded border whitespace-nowrap', SIZES[size], className)}
      style={{ color: s.color, backgroundColor: s.bg, borderColor: s.border }}
    >
      {signal}
      {valuePct !== undefined && (
        <span className="opacity-70">{valuePct > 0 ? '+' : ''}{valuePct.toFixed(0)}%</span>
      )}
    </span>
  );
}
