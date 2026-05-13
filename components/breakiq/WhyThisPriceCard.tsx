'use client';

import { useMemo } from 'react';
import { formatCurrency, computeEffectiveScore, confidenceTier } from '@/lib/engine';
import { RISK_ADJUSTMENTS } from '@/lib/score-modulation';
import {
  lifecycleEvMultiplier,
  RELEASE_PREMIUM,
  FRESHNESS_PREMIUM,
  FRESHNESS_HALFLIFE_DAYS,
} from '@/lib/market-markup';
import type { BreakFormat, PlayerWithPricing, ProductLifecycle } from '@/lib/types';

// Consumer audit-trail surface — "Why this price?" decomposition.
//
// Strategy thread: makes the multi-source pricing model visible. Without this
// card, Track A (prospect rank) and Track B (SME sentiment) are invisible
// moat-building — the user sees a number with no provenance. This card is the
// answer to "where did $1,447 come from?"
//
// Pure render component — accepts a PlayerWithPricing row plus its product
// context and decomposes the slot price into baseline EV, math-layer
// lifecycle multipliers, score adjustments (Track A + AI buzz + SME +
// risk + hype), and the display-layer market markup.

type RiskFlag = { flagType: string; note: string };

export interface WhyThisPriceProps {
  row: PlayerWithPricing;
  productLifecycle: ProductLifecycle | null;
  liveSince: string | null;
  marketMarkup: number;
  viewFormat: BreakFormat;
  riskFlags: RiskFlag[];
}

function pickSlot(row: PlayerWithPricing, fmt: BreakFormat): number {
  return fmt === 'hobby' ? row.hobbySlotCost
    : fmt === 'bd'       ? row.bdSlotCost
    :                      row.jumboSlotCost;
}

function signed(n: number, digits = 2): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
}

function colorForAdj(n: number): string {
  if (n > 0.05) return '#22c55e';
  if (n < -0.05) return '#ef4444';
  return 'var(--text-secondary)';
}

export default function WhyThisPriceCard({
  row,
  productLifecycle,
  liveSince,
  marketMarkup,
  viewFormat,
  riskFlags,
}: WhyThisPriceProps) {
  const modelSlot = pickSlot(row, viewFormat);
  const marketSlot = modelSlot * marketMarkup;

  const lifecycleMath = lifecycleEvMultiplier(productLifecycle, liveSince);
  const buzz = row.buzz_score ?? 0;
  const sme = row.breakerz_score ?? 0;
  const risk = row.risk_score_adj ?? 0;
  const hype = row.hype_score_adj ?? 0;
  const prospect = row.prospect_score_adj ?? 0;
  // Track B cascade (Phase 2). Per-scope breakdown is Phase 3 UI; for now
  // fold the combined value through computeEffectiveScore so the displayed
  // total matches what computeSlotPricing actually used. When non-zero, the
  // score-modulation stack adds a single "Cascade sentiment" row.
  const cascade = row.cascade_score_adj ?? 0;
  const isIcon = row.player?.is_icon ?? false;
  const effective = computeEffectiveScore(buzz, sme, isIcon, risk, hype, prospect, cascade);

  const isEstimated = row.pricingSource === 'search-fallback' || row.pricingSource === 'cross-product' || row.pricingSource === 'default';
  const confInfo = !isEstimated ? confidenceTier(row.confidence) : null;

  // Reverse-derive the pre-lifecycle baseline so we can show the math-layer
  // contribution as a separate line. cached evMid already incorporates
  // lifecycleMath, so baseEv ≈ evMid / lifecycleMath. We only display this
  // when the multiplier is doing real work (≠ 1.0).
  const baseEv = lifecycleMath > 0 ? row.evMid / lifecycleMath : row.evMid;
  const showLifecycleLine = Math.abs(lifecycleMath - 1) > 0.001;

  const scoreRows = useMemo(() => {
    if (isIcon) {
      return [{ label: 'Icon player', detail: 'Score modulation disabled (always slot-weighted by raw EV)', value: 0, locked: true }];
    }
    const rows: Array<{ label: string; detail: string; value: number; locked?: boolean }> = [];
    if (Math.abs(prospect) > 0.001) {
      rows.push({
        label: 'Prospect rank (Track A)',
        detail: row.player?.prospect_rank_source
          ? `${row.player.prospect_rank_source}${row.player.prospect_rank ? ` · #${row.player.prospect_rank}` : ''}${row.player.prospect_status ? ` · ${row.player.prospect_status.replace('_', ' ')}` : ''}`
          : row.player?.prospect_rank
          ? `Rank #${row.player.prospect_rank}`
          : 'Objective prospect attributes',
        value: prospect,
      });
    }
    if (Math.abs(sme) > 0.001) {
      rows.push({
        label: 'SME sentiment',
        detail: row.breakerz_note ?? 'Discord /insight contribution',
        value: sme,
      });
    }
    if (Math.abs(buzz) > 0.001) {
      rows.push({ label: 'AI buzz', detail: 'Aggregate market signal', value: buzz });
    }
    if (Math.abs(risk) > 0.001) {
      const worst = riskFlags
        .map(f => ({ f, adj: RISK_ADJUSTMENTS[f.flagType as keyof typeof RISK_ADJUSTMENTS] ?? 0 }))
        .sort((a, b) => a.adj - b.adj)[0];
      rows.push({
        label: 'Risk flag',
        detail: worst ? `${worst.f.flagType.replace('_', ' ')}: ${worst.f.note || '—'}` : 'Active risk flag',
        value: risk,
      });
    }
    if (Math.abs(hype) > 0.001) {
      rows.push({
        label: 'Hype tag',
        detail: 'Live market observation (decaying)',
        value: hype,
      });
    }
    if (Math.abs(cascade) > 0.001) {
      rows.push({
        label: 'Cascade sentiment (Track B)',
        detail: 'Team / Product / Team×Product observations · per-scope split in Phase 3',
        value: cascade,
      });
    }
    return rows;
  }, [isIcon, prospect, sme, buzz, risk, hype, cascade, row, riskFlags]);

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>
        Why this price?
      </p>

      {/* Slot summary */}
      <div
        className="rounded-lg p-4 mb-3"
        style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
      >
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
            {viewFormat} slot
          </span>
          <span className="text-xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
            {formatCurrency(marketSlot)}
          </span>
        </div>
        {marketMarkup !== 1 && (
          <div className="flex items-baseline justify-between text-[11px] mb-1">
            <span style={{ color: 'var(--text-tertiary)' }}>BreakIQ model</span>
            <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(modelSlot)}</span>
          </div>
        )}
        {marketMarkup !== 1 && (
          <div className="flex items-baseline justify-between text-[11px]">
            <span style={{ color: 'var(--text-tertiary)' }}>× market markup ({productLifecycle ?? 'live'})</span>
            <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>×{marketMarkup.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Decomposition */}
      <div
        className="rounded-lg overflow-hidden"
        style={{ border: '1px solid var(--terminal-border)' }}
      >
        {/* Baseline */}
        <Row
          label="Baseline EV (mid)"
          detail={`CardHedger sales aggregate · raw → PSA 9 → PSA 10`}
          value={formatCurrency(showLifecycleLine ? baseEv : row.evMid)}
          valueColor="var(--text-primary)"
        />

        {showLifecycleLine && (
          <Row
            label={productLifecycle === 'pre_release' ? 'Release premium' : 'Freshness decay'}
            detail={
              productLifecycle === 'pre_release'
                ? `Sibling comps lift by ${((RELEASE_PREMIUM - 1) * 100).toFixed(0)}% for unreleased product`
                : `Up to +${(FRESHNESS_PREMIUM * 100).toFixed(0)}% at launch, halflife ${FRESHNESS_HALFLIFE_DAYS}d, settles past 30d`
            }
            value={`×${lifecycleMath.toFixed(3)}`}
            valueColor="var(--accent-blue)"
          />
        )}

        {showLifecycleLine && (
          <Row
            label="EV after lifecycle"
            detail="What this card is worth in this lifecycle window"
            value={formatCurrency(row.evMid)}
            valueColor="var(--text-primary)"
            emphasis
          />
        )}

        {scoreRows.length > 0 && (
          <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest border-t" style={{ color: 'var(--text-tertiary)', borderColor: 'var(--terminal-border)' }}>
            Score modulation (folds into pool weight)
          </div>
        )}
        {scoreRows.map((s, i) => (
          <Row
            key={i}
            label={s.label}
            detail={s.detail}
            value={s.locked ? 'locked' : signed(s.value)}
            valueColor={s.locked ? 'var(--text-tertiary)' : colorForAdj(s.value)}
          />
        ))}

        {scoreRows.length > 0 && (
          <Row
            label="Effective score"
            detail="Sum, clamped to [−0.9, +1.0]"
            value={signed(effective)}
            valueColor={colorForAdj(effective)}
            emphasis
          />
        )}

        {/* How it becomes a slot */}
        <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest border-t" style={{ color: 'var(--text-tertiary)', borderColor: 'var(--terminal-border)' }}>
          Pool allocation
        </div>
        <Row
          label="Weighted by EV × (1 + score)"
          detail={`This player's share of the ${viewFormat === 'bd' ? 'BD' : viewFormat} pool`}
          value={
            viewFormat === 'hobby'
              ? row.hobbyWeight > 0 ? formatCurrency(row.hobbyWeight) : '—'
              : viewFormat === 'jumbo'
              ? row.jumboWeight > 0 ? formatCurrency(row.jumboWeight) : '—'
              : row.bdWeight > 0 ? formatCurrency(row.bdWeight) : '—'
          }
          valueColor="var(--text-secondary)"
        />
        <Row
          label="Model slot cost"
          detail="Break cost × pool share"
          value={formatCurrency(modelSlot)}
          valueColor="var(--text-primary)"
          emphasis
        />
      </div>

      {/* Confidence + source */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isEstimated && (
          <span
            className="text-[10px] font-medium px-2 py-1 rounded border"
            title={`Pricing source: ${row.pricingSource}`}
            style={{
              backgroundColor: 'rgba(245,158,11,0.1)',
              color: 'var(--accent-orange)',
              borderColor: 'rgba(245,158,11,0.3)',
            }}
          >
            estimated · {row.pricingSource}
          </span>
        )}
        {confInfo && (
          <span
            className="text-[10px] font-medium px-2 py-1 rounded border"
            title={`CardHedger confidence: ${(row.confidence! * 100).toFixed(0)}%`}
            style={{ backgroundColor: confInfo.bg, color: confInfo.fg, borderColor: confInfo.border }}
          >
            confidence · {confInfo.label}
          </span>
        )}
        {row.player?.is_icon && (
          <span
            className="text-[10px] font-medium px-2 py-1 rounded border"
            style={{ backgroundColor: 'rgba(168,85,247,0.1)', color: '#a855f7', borderColor: 'rgba(168,85,247,0.3)' }}
          >
            icon player
          </span>
        )}
        {row.is_high_volatility && (
          <span
            className="text-[10px] font-medium px-2 py-1 rounded border"
            style={{ backgroundColor: 'rgba(234,179,8,0.1)', color: '#eab308', borderColor: 'rgba(234,179,8,0.3)' }}
          >
            high volatility
          </span>
        )}
      </div>

      <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
        Math-layer multipliers bake into cached EV. Score modulation runs at render time and folds into the pool weight that determines slot share. Market markup applies last and is breaker-charge over our pure EV.
      </p>
    </div>
  );
}

function Row({
  label,
  detail,
  value,
  valueColor,
  emphasis,
}: {
  label: string;
  detail?: string;
  value: string;
  valueColor: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className="flex items-start justify-between gap-3 px-3 py-2 border-b last:border-b-0"
      style={{
        borderColor: 'var(--terminal-border)',
        backgroundColor: emphasis ? 'var(--terminal-surface-hover)' : 'transparent',
      }}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium" style={{ color: emphasis ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
          {label}
        </p>
        {detail && (
          <p className="text-[10px] leading-tight mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {detail}
          </p>
        )}
      </div>
      <span
        className={`font-mono shrink-0 ${emphasis ? 'text-sm font-bold' : 'text-xs'}`}
        style={{ color: valueColor }}
      >
        {value}
      </span>
    </div>
  );
}
