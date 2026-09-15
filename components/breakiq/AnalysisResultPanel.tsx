'use client';

import Link from 'next/link';
import { signalLabel, formatCurrency } from '@/lib/engine';
import PricingFeedback from '@/components/breakiq/PricingFeedback';
import type { AnalysisResult } from '@/lib/analysis';
import type { Signal } from '@/lib/types';

// The handoff labels the middle verdict HOLD; the engine's Signal union is
// 'WATCH' and that value is PERSISTED in user_breaks.snapshot_signal. This is a
// DISPLAY-LAYER mapping only — renaming stored rows for a copy change is the
// kind of conflict the UI-only scope says to avoid.
const signalConfig: Record<Signal, { borderColor: string; bgColor: string; textColor: string }> = {
  BUY:   { borderColor: 'var(--buy)',  bgColor: 'var(--signal-buy-bg)',   textColor: 'var(--buy)'  },
  WATCH: { borderColor: 'var(--hold)', bgColor: 'var(--signal-watch-bg)', textColor: 'var(--hold)' },
  PASS:  { borderColor: 'var(--pass)', bgColor: 'var(--signal-pass-bg)',  textColor: 'var(--pass)' },
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

  // "Bought in? Log this break" — carry the analyzed config into the My Breaks
  // new-break form so the user doesn't re-enter what they just configured.
  const logBreakHref = (() => {
    const params = new URLSearchParams({ view: 'new', productId, ask: String(Math.round(result.askPrice)) });
    if (result.teams.length) params.set('teams', result.teams.join(','));
    (['hobby', 'bd', 'jumbo'] as const).forEach(k => {
      if (result.formats[k] > 0) params.set(k, String(result.formats[k]));
    });
    return `/my-breaks?${params.toString()}`;
  })();

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink3)' }}>
            Our take
          </p>
          <PricingFeedback
            surface="break_analysis"
            entityType="analysis"
            entityId={productId}
            productId={productId}
            size="md"
          />
        </div>

        {/* Verdict band — three fields between rules, split by vertical hairlines. */}
        <div
          className="flex flex-col sm:flex-row"
          style={{ borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' }}
        >
          <div className="py-[22px] sm:pr-[34px]">
            <p className="font-mono uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink3)' }}>
              Verdict
            </p>
            <p style={{ fontSize: 25, fontWeight: 700, lineHeight: 1, letterSpacing: '0.02em', color: cfg.textColor }}>
              {signalLabel(result.signal)}
            </p>
          </div>

          <div
            className="py-[22px] sm:px-[34px] sm:border-l"
            style={{ borderColor: 'var(--rule)' }}
          >
            <p className="font-mono uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink3)' }}>
              Fair value
            </p>
            <p className="font-mono" style={{ fontSize: 29, fontWeight: 500, lineHeight: 1, letterSpacing: '-0.03em', color: 'var(--ink)' }}>
              {formatCurrency(result.marketFairValue)}
            </p>
            <p className="font-mono mt-1" style={{ fontSize: 12, color: 'var(--ink3)' }}>
              {formatCurrency(result.marketFairLow)}–{formatCurrency(result.marketFairHigh)}
            </p>
          </div>

          <div
            className="py-[22px] sm:px-[34px] sm:border-l"
            style={{ borderColor: 'var(--rule)' }}
          >
            <p className="font-mono uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink3)' }}>
              Ask vs value
            </p>
            <p className="font-mono" style={{ fontSize: 29, fontWeight: 500, lineHeight: 1, letterSpacing: '-0.03em', color: cfg.textColor }}>
              {result.valuePct >= 0 ? '+' : '−'}{Math.abs(result.valuePct).toFixed(0)}%
            </p>
            <p className="font-mono mt-1" style={{ fontSize: 12, color: 'var(--ink3)' }}>
              {formatCurrency(result.askPrice)} ask
            </p>
          </div>
        </div>

        <p className="mt-3" style={{ fontSize: 12, color: 'var(--ink3)' }}>
          {compositionLabel} · {formatLine || '0 cases'} · {aboveBelow} our value
        </p>

        <p className="mt-3" style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink2)' }}>
          {result.analysis}
        </p>

        <p className="mt-2" style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--ink3)' }}>
          CardHedger comps + our lifecycle-aware model. Flag it if it&rsquo;s off — we tune from every report.
        </p>
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
                  backgroundColor: 'rgba(127,168,201,0.12)',
                  color: 'var(--text-primary)',
                  borderColor: 'rgba(127,168,201,0.4)',
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
        <div className="rounded-lg p-4 border flex items-start gap-3" style={{ backgroundColor: 'rgba(168,144,96,0.08)', borderColor: 'var(--signal-watch)' }}>
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
            <div key={i} className="rounded-lg p-4 border flex items-start gap-3" style={{ backgroundColor: 'rgba(194,112,95,0.05)', borderColor: 'var(--signal-pass)' }}>
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

      {productId && (
        <Link
          href={logBreakHref}
          className="block w-full text-center rounded-lg px-4 py-2.5 text-sm font-bold transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--accent-blue)', color: 'white' }}
        >
          Bought in? Log this break →
        </Link>
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
