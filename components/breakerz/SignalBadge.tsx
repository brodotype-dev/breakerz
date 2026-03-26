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
  BUY:   { color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.3)' },
  WATCH: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.3)' },
  PASS:  { color: '#dc2626', bg: 'rgba(220,38,38,0.1)',   border: 'rgba(220,38,38,0.3)' },
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
