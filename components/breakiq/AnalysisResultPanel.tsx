'use client';

import Link from 'next/link';
import { formatCurrency } from '@/lib/engine';
import PricingFeedback from '@/components/breakiq/PricingFeedback';
import type { AnalysisResult } from '@/lib/analysis';
import type { Signal } from '@/lib/types';

const signalConfig: Record<Signal, { borderColor: string; bgColor: string; textColor: string; label: string }> = {
  BUY:   { borderColor: 'var(--signal-buy)',   bgColor: 'rgba(34,197,94,0.08)',  textColor: 'var(--signal-buy)',   label: 'BUY' },
  WATCH: { borderColor: 'var(--signal-watch)', bgColor: 'rgba(234,179,8,0.08)',  textColor: 'var(--signal-watch)', label: 'WATCH' },
  PASS:  { borderColor: 'var(--signal-pass)',  bgColor: 'rgba(239,68,68,0.08)',  textColor: 'var(--signal-pass)',  label: 'PASS' },
};

const FLAG_LABELS: Record<string, string> = {
  injury: 'Injury', suspension: 'Suspension', legal: 'Legal',
  trade: 'Trade', retirement: 'Retirement', off_field: 'Off-field',
};

interface Props {
  result: AnalysisResult;
  productId: string;
  // Slug for the "View full break analysis" link. When omitted (e.g. we're
  // already rendering ON the break page), the link is hidden.
  productSlug?: string | null;
}

/**
 * Renders the result of `runBreakAnalysis` — signal verdict, market ask
 * range vs total cost, Claude narrative, bundle composition, top players,
 * HV advisory, risk flags. Shared between the standalone /analysis page
 * and the inline break-page analysis block.
 */
export default function AnalysisResultPanel({ result, productId, productSlug }: Props) {
  const cfg = signalConfig[result.signal];
  const aboveBelow = result.valuePct >= 0 ? 'below fair value' : 'above fair value';
  const formatLine = (['hobby', 'jumbo', 'bd'] as const)
    .filter(k => result.formats[k] > 0)
    .map(k => `${result.formats[k]} ${k === 'hobby' ? 'Hobby' : k === 'bd' ? 'BD' : 'Jumbo'}`)
    .join(' + ');

  const compositionLabel = [
    result.teams.length ? `${result.teams.length} team${result.teams.length === 1 ? '' : 's'}` : null,
    result.extraPlayerNames.length ? `${result.extraPlayerNames.length} player slot${result.extraPlayerNames.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' + ');

  return (
    <div className="space-y-4">
      <div className="rounded-lg p-6 border-2" style={{ backgroundColor: cfg.bgColor, borderColor: cfg.borderColor }}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-3xl font-black" style={{ color: cfg.textColor }}>{cfg.label}</span>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold font-mono" style={{ color: cfg.textColor }}>
                {Math.abs(result.valuePct).toFixed(1)}% {aboveBelow}
              </p>
            </div>
            <PricingFeedback
              surface="break_analysis"
              entityType="analysis"
              entityId={productId}
              productId={productId}
              size="md"
            />
          </div>
        </div>

        <div className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {compositionLabel} · {formatLine || '0 cases'}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="terminal-label mb-1">Market Ask Range</p>
            <p className="font-mono text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(result.marketFairValue)}</p>
            <p className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              {formatCurrency(result.marketFairLow)}–{formatCurrency(result.marketFairHigh)} · model {formatCurrency(result.fairValue)}
            </p>
          </div>
          <div>
            <p className="terminal-label mb-1">Total Cost</p>
            <p className="font-mono text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(result.askPrice)}</p>
          </div>
        </div>

        <div className="pl-4 border-l-2 py-1" style={{ borderColor: 'var(--accent-blue)' }}>
          <p className="text-sm leading-relaxed italic" style={{ color: 'var(--text-secondary)' }}>{result.analysis}</p>
        </div>
      </div>

      {(result.teams.length > 0 || result.extraPlayerNames.length > 0) && (
        <div className="rounded-lg p-4 border" style={{ backgroundColor: 'var(--terminal-bg)', borderColor: 'var(--terminal-border)' }}>
          <p className="terminal-label mb-2">Bundle composition</p>
          <div className="flex flex-wrap gap-1.5">
            {result.teams.map(t => (
              <span key={t} className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ backgroundColor: 'var(--accent-blue)', color: 'white' }}>{t}</span>
            ))}
            {result.extraPlayerNames.map(n => (
              <span
                key={n}
                className="text-[10px] font-bold px-2 py-1 rounded-full border"
                style={{
                  backgroundColor: 'rgba(59, 130, 246, 0.12)',
                  color: 'var(--text-primary)',
                  borderColor: 'rgba(59, 130, 246, 0.4)',
                }}
              >
                {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {result.topPlayers.length > 0 && (
        <div className="rounded-lg p-5 border" style={{ backgroundColor: 'var(--terminal-bg)', borderColor: 'var(--terminal-border)' }}>
          <p className="terminal-label mb-3">Top players in bundle</p>
          <div className="space-y-3">
            {result.topPlayers.map(p => (
              <div key={`${p.team}-${p.name}`} className="flex items-center justify-between py-2 border-b last:border-b-0" style={{ borderColor: 'var(--terminal-border)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                  <span className="text-[10px] uppercase" style={{ color: 'var(--text-tertiary)' }}>{p.team}</span>
                  {p.isRookie && <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--accent-blue)', color: 'white' }}>RC</span>}
                  {p.isIcon && <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--badge-icon)', color: 'var(--terminal-bg)' }}>★ Icon</span>}
                </div>
                <div className="flex items-center gap-4 font-mono text-xs">
                  <div><span className="terminal-label mr-1">EV</span><span style={{ color: 'var(--text-primary)' }}>{formatCurrency(p.evMid)}</span></div>
                  <div><span className="terminal-label mr-1">↑</span><span style={{ color: 'var(--signal-buy)' }}>{formatCurrency(p.evHigh)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.hvPlayers?.length > 0 && (
        <div className="rounded-lg p-4 border flex items-start gap-3" style={{ backgroundColor: 'rgba(234,179,8,0.08)', borderColor: 'var(--signal-watch)' }}>
          <span className="text-lg">⚡</span>
          <div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--signal-watch)' }}>High Volatility Advisory</p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {result.hvPlayers.join(', ')} — market pricing is unusually uncertain. EVs may shift significantly.
            </p>
          </div>
        </div>
      )}

      {result.riskFlags?.length > 0 && (
        <div className="space-y-2">
          {result.riskFlags.map((flag, i) => (
            <div key={i} className="rounded-lg p-4 border flex items-start gap-3" style={{ backgroundColor: 'rgba(239,68,68,0.05)', borderColor: 'var(--signal-pass)' }}>
              <span className="text-sm font-bold opacity-60" style={{ color: 'var(--signal-pass)' }}>⚑</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{flag.playerName}</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ backgroundColor: 'var(--signal-pass)', color: 'white' }}>
                    {FLAG_LABELS[flag.flagType] ?? flag.flagType}
                  </span>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{flag.note}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {productSlug && (
        <div className="pt-2 border-t" style={{ borderColor: 'var(--terminal-border)' }}>
          <Link href={`/break/${productSlug}`} className="text-xs font-medium hover:underline" style={{ color: 'var(--accent-blue)' }}>
            View full break analysis →
          </Link>
        </div>
      )}
    </div>
  );
}
