'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import type { PricingBreakdownRow } from '@/app/api/admin/pricing-breakdown/[productId]/route';

interface Props {
  productId: string;
  hobbyCaseCost: number;
  bdCaseCost: number | null;
}

interface Config {
  hobbyCases: number;
  hobbyCaseCost: number;
  bdCases: number;
  bdCaseCost: number;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function fmt(v: number | null, prefix = '$') {
  if (v == null) return '—';
  return `${prefix}${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtDecimal(v: number, digits = 2) {
  return v.toFixed(digits);
}

function fmtPct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

interface ComputedRow extends PricingBreakdownRow {
  hobbyEVPerBox: number;
  effectiveScore: number;
  hobbyWeight: number;
  weightPct: number;
  hobbySlotCost: number;
  bdSlotCost: number;
}

function computeRows(rows: PricingBreakdownRow[], config: Config): ComputedRow[] {
  const eligible = rows.filter(r => !r.insertOnly);

  const computed: ComputedRow[] = eligible.map(r => {
    // hobbyEVPerBox: approximate using sumInverseOdds × evMid if odds available, else evMid
    const evMid = r.evMid ?? 0;
    const hobbyEVPerBox = r.variantOddsCount > 0 ? evMid * r.sumInverseOdds : evMid;

    const effectiveScore = r.isIcon
      ? 0
      : clamp((r.buzzScore ?? 0) + (r.breakerzScore ?? 0), -0.9, 1.0);

    const hobbyWeight = r.hobbySets > 0 ? hobbyEVPerBox * (1 + effectiveScore) : 0;

    return { ...r, hobbyEVPerBox, effectiveScore, hobbyWeight, weightPct: 0, hobbySlotCost: 0, bdSlotCost: 0 };
  });

  const totalHobbyWeight = computed.reduce((s, r) => s + r.hobbyWeight, 0);
  const totalBdEV = computed.reduce((s, r) => s + (r.evMid ?? 0), 0);
  const hobbyBreakCost = config.hobbyCases * config.hobbyCaseCost;
  const bdBreakCost = config.bdCases * config.bdCaseCost;

  return computed.map(r => ({
    ...r,
    weightPct: totalHobbyWeight > 0 ? r.hobbyWeight / totalHobbyWeight : 0,
    hobbySlotCost: totalHobbyWeight > 0 ? hobbyBreakCost * (r.hobbyWeight / totalHobbyWeight) : 0,
    bdSlotCost: totalBdEV > 0 ? bdBreakCost * ((r.evMid ?? 0) / totalBdEV) : 0,
  }));
}

function exportCSV(rows: ComputedRow[], config: Config) {
  const header = [
    'Player', 'Team', 'EV Low', 'EV Mid', 'EV High',
    'Hobby Sets', 'BD Sets', 'Has Odds', 'EV/Box (Hobby)',
    'Buzz', 'B-Score', 'Eff. Score', 'Weight', 'Weight %',
    'Hobby Slot', 'BD Slot',
  ].join(',');

  const lines = rows.map(r => [
    `"${r.playerName}"`,
    `"${r.playerTeam}"`,
    r.evLow ?? '',
    r.evMid ?? '',
    r.evHigh ?? '',
    r.hobbySets,
    r.bdOnlySets,
    r.variantOddsCount > 0 ? 'Yes' : 'No',
    r.hobbyEVPerBox.toFixed(2),
    r.buzzScore ?? 0,
    r.breakerzScore ?? 0,
    r.effectiveScore.toFixed(3),
    r.hobbyWeight.toFixed(2),
    (r.weightPct * 100).toFixed(1) + '%',
    r.hobbySlotCost.toFixed(0),
    r.bdSlotCost.toFixed(0),
  ].join(','));

  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pricing-breakdown.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PricingBreakdownPanel({ productId, hobbyCaseCost, bdCaseCost }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PricingBreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config>({
    hobbyCases: 1,
    hobbyCaseCost,
    bdCases: 0,
    bdCaseCost: bdCaseCost ?? 0,
  });

  useEffect(() => {
    if (!open || rows.length) return;
    setLoading(true);
    fetch(`/api/admin/pricing-breakdown/${productId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setRows(data.rows ?? []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, productId, rows.length]);

  const computed = useMemo(() => computeRows(rows, config), [rows, config]);

  const totalHobbyWeight = computed.reduce((s, r) => s + r.hobbyWeight, 0);
  const totalHobbySlot = computed.reduce((s, r) => s + r.hobbySlotCost, 0);
  const totalBdSlot = computed.reduce((s, r) => s + r.bdSlotCost, 0);

  function field(label: string, key: keyof Config, prefix = '$') {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
          {label}
        </label>
        <div className="flex items-center gap-1">
          <span className="text-xs" style={{ color: 'var(--text-disabled)' }}>{prefix}</span>
          <input
            type="number"
            min={0}
            value={config[key]}
            onChange={e => setConfig(c => ({ ...c, [key]: Number(e.target.value) }))}
            className="w-20 rounded border bg-transparent px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-primary)' }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
      <div className="h-1" style={{ background: 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)' }} />

      {/* Header — toggle */}
      <button
        className="w-full flex items-center justify-between p-5 hover:bg-[var(--terminal-surface-hover)] transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />}
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
            Pricing Audit
          </h2>
          {computed.length > 0 && (
            <span className="text-xs" style={{ color: 'var(--text-disabled)' }}>
              {computed.length} players
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: 'var(--text-disabled)' }}>
          {open ? 'Collapse' : 'Expand to audit pricing math'}
        </span>
      </button>

      {open && (
        <div className="p-5 space-y-5 border-t" style={{ borderColor: 'var(--terminal-border)' }}>

          {/* Config bar */}
          <div className="flex flex-wrap gap-6 p-4 rounded-lg" style={{ backgroundColor: 'var(--terminal-surface-hover)', border: '1px solid var(--terminal-border)' }}>
            <div className="flex items-center gap-1.5 mr-2">
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent-blue)' }}>Break Config</span>
              <span className="text-[10px]" style={{ color: 'var(--text-disabled)' }}>(edit to recalculate live)</span>
            </div>
            {field('Hobby Cases', 'hobbyCases', '#')}
            {field('Hobby / Case', 'hobbyCaseCost')}
            {field('BD Cases', 'bdCases', '#')}
            {field('BD / Case', 'bdCaseCost')}
          </div>

          {/* Formula key */}
          <div className="text-[11px] font-mono px-3 py-2 rounded" style={{ backgroundColor: 'rgba(99,102,241,0.08)', color: 'var(--text-secondary)', border: '1px solid rgba(99,102,241,0.2)' }}>
            <span style={{ color: 'var(--accent-blue)' }}>EV/Box</span>
            {' = evMid × Σ(1/odds)  ·  '}
            <span style={{ color: 'var(--accent-blue)' }}>Eff</span>
            {' = clamp(buzz + b‑score, −0.9, 1.0)  [0 if icon]  ·  '}
            <span style={{ color: 'var(--accent-blue)' }}>Weight</span>
            {' = EV/Box × (1 + Eff)  ·  '}
            <span style={{ color: 'var(--accent-blue)' }}>Slot</span>
            {' = BreakCost × Weight / ΣWeights'}
          </div>

          {loading && (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--text-secondary)' }}>Loading…</p>
          )}

          {error && (
            <p className="text-xs py-4 text-center text-red-400">{error}</p>
          )}

          {!loading && !error && computed.length > 0 && (
            <>
              {/* Table */}
              <div className="rounded-lg overflow-auto" style={{ border: '1px solid var(--terminal-border)' }}>
                <table className="w-full text-xs min-w-[1000px]">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-tertiary)' }}>
                      {['Player', 'Team', 'EV Low', 'EV Mid', 'EV High', 'H.Sets', 'BD.Sets', 'Odds?', 'EV/Box', 'Buzz', 'B-Score', 'Eff.', 'Weight', 'Wt%', 'Hobby Slot', 'BD Slot'].map(h => (
                        <th key={h} className="text-left px-2.5 py-2 font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
                    {computed.map(r => {
                      const noCached = r.evMid == null;
                      return (
                        <tr key={r.playerProductId} className="hover:bg-[var(--terminal-surface-hover)] transition-colors">
                          <td className="px-2.5 py-1.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                            {r.playerName}
                            {r.isIcon && <span className="ml-1 text-purple-400">★</span>}
                          </td>
                          <td className="px-2.5 py-1.5" style={{ color: 'var(--text-secondary)' }}>{r.playerTeam || '—'}</td>
                          <td className="px-2.5 py-1.5 font-mono" style={{ color: noCached ? 'var(--text-disabled)' : 'var(--text-secondary)' }}>{noCached ? '—' : fmt(r.evLow)}</td>
                          <td className="px-2.5 py-1.5 font-mono font-medium" style={{ color: noCached ? 'var(--text-disabled)' : 'var(--text-primary)' }}>{noCached ? '—' : fmt(r.evMid)}</td>
                          <td className="px-2.5 py-1.5 font-mono" style={{ color: noCached ? 'var(--text-disabled)' : 'var(--text-secondary)' }}>{noCached ? '—' : fmt(r.evHigh)}</td>
                          <td className="px-2.5 py-1.5 font-mono" style={{ color: 'var(--text-secondary)' }}>{r.hobbySets}</td>
                          <td className="px-2.5 py-1.5 font-mono" style={{ color: 'var(--text-secondary)' }}>{r.bdOnlySets}</td>
                          <td className="px-2.5 py-1.5" style={{ color: r.variantOddsCount > 0 ? 'var(--signal-buy)' : 'var(--text-disabled)' }}>
                            {r.variantOddsCount > 0 ? `${r.variantOddsCount}` : '—'}
                          </td>
                          <td className="px-2.5 py-1.5 font-mono" style={{ color: noCached ? 'var(--text-disabled)' : 'var(--text-primary)' }}>
                            {noCached ? '—' : `$${fmtDecimal(r.hobbyEVPerBox)}`}
                          </td>
                          <td className="px-2.5 py-1.5 font-mono" style={{ color: (r.buzzScore ?? 0) > 0 ? 'var(--signal-buy)' : (r.buzzScore ?? 0) < 0 ? 'var(--signal-pass)' : 'var(--text-disabled)' }}>
                            {r.buzzScore != null ? fmtDecimal(r.buzzScore, 3) : '—'}
                          </td>
                          <td className="px-2.5 py-1.5 font-mono" style={{ color: (r.breakerzScore ?? 0) > 0 ? 'var(--signal-buy)' : (r.breakerzScore ?? 0) < 0 ? 'var(--signal-pass)' : 'var(--text-disabled)' }}>
                            {r.breakerzScore != null ? fmtDecimal(r.breakerzScore, 3) : '—'}
                          </td>
                          <td className="px-2.5 py-1.5 font-mono" style={{ color: r.effectiveScore > 0 ? 'var(--signal-buy)' : r.effectiveScore < 0 ? 'var(--signal-pass)' : 'var(--text-secondary)' }}>
                            {r.isIcon ? <span style={{ color: 'var(--text-disabled)' }}>0 ★</span> : fmtDecimal(r.effectiveScore, 3)}
                          </td>
                          <td className="px-2.5 py-1.5 font-mono" style={{ color: noCached ? 'var(--text-disabled)' : 'var(--text-secondary)' }}>
                            {noCached ? '—' : fmtDecimal(r.hobbyWeight, 2)}
                          </td>
                          <td className="px-2.5 py-1.5 font-mono" style={{ color: 'var(--text-secondary)' }}>
                            {noCached ? '—' : fmtPct(r.weightPct)}
                          </td>
                          <td className="px-2.5 py-1.5 font-mono font-medium" style={{ color: noCached ? 'var(--text-disabled)' : 'var(--accent-blue)' }}>
                            {noCached ? '—' : fmt(Math.round(r.hobbySlotCost))}
                          </td>
                          <td className="px-2.5 py-1.5 font-mono" style={{ color: noCached ? 'var(--text-disabled)' : 'var(--text-secondary)' }}>
                            {noCached || config.bdCases === 0 ? '—' : fmt(Math.round(r.bdSlotCost))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>

                  {/* Totals row */}
                  <tfoot>
                    <tr style={{ backgroundColor: 'var(--terminal-surface-hover)', borderTop: '2px solid var(--terminal-border)' }}>
                      <td className="px-2.5 py-2 font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }} colSpan={12}>
                        Totals
                      </td>
                      <td className="px-2.5 py-2 font-mono font-bold" style={{ color: 'var(--text-primary)' }}>{fmtDecimal(totalHobbyWeight, 1)}</td>
                      <td className="px-2.5 py-2 font-mono" style={{ color: 'var(--text-secondary)' }}>100%</td>
                      <td className="px-2.5 py-2 font-mono font-bold" style={{ color: 'var(--accent-blue)' }}>{fmt(Math.round(totalHobbySlot))}</td>
                      <td className="px-2.5 py-2 font-mono" style={{ color: 'var(--text-secondary)' }}>
                        {config.bdCases > 0 ? fmt(Math.round(totalBdSlot)) : '—'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Uncached players note */}
              {computed.some(r => r.evMid == null) && (
                <p className="text-xs" style={{ color: 'var(--text-disabled)' }}>
                  — = no cached EV. Run a pricing refresh from the break page to populate.
                </p>
              )}

              {/* Export */}
              <div className="flex justify-end">
                <button
                  onClick={() => exportCSV(computed, config)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-[var(--terminal-surface-hover)]"
                  style={{ border: '1px solid var(--terminal-border)', color: 'var(--text-secondary)' }}
                >
                  <Download className="w-3 h-3" />
                  Export CSV
                </button>
              </div>
            </>
          )}

          {!loading && !error && rows.length === 0 && (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--text-secondary)' }}>No players found for this product.</p>
          )}
        </div>
      )}
    </div>
  );
}
