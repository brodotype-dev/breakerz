'use client';

import { cn } from '@/lib/utils';
import { signalLabel } from '@/lib/engine';
import type { Signal } from '@/lib/types';

interface Props {
  signal: Signal;
  size?: 'sm' | 'md' | 'lg';
  valuePct?: number;
  className?: string;
}

const STYLES: Record<Signal, { color: string; bg: string; border: string }> = {
  BUY:   { color: 'var(--buy)',  bg: 'rgba(111,158,125,0.1)', border: 'rgba(111,158,125,0.3)' },
  WATCH: { color: 'var(--hold)', bg: 'rgba(168,144,96,0.1)',  border: 'rgba(168,144,96,0.3)' },
  PASS:  { color: 'var(--pass)', bg: 'rgba(194,112,95,0.1)',  border: 'rgba(194,112,95,0.3)' },
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
      {signalLabel(signal)}
      {valuePct !== undefined && (
        <span className="opacity-70">{valuePct > 0 ? '+' : ''}{valuePct.toFixed(0)}%</span>
      )}
    </span>
  );
}
