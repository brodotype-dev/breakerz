'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveBreakerzBets } from '../actions';

interface ParsedResult {
  player_product_id: string;
  player_name: string;
  suggested_score: number;
  reason_note: string;
  confidence: number;
}

interface ReviewRow extends ParsedResult {
  score: number;
  note: string;
  included: boolean;
  is_rookie: boolean;
}

const SCORE_PILLS = [
  { value: -0.5, label: '−0.5', color: 'bg-red-600 text-white' },
  { value: -0.25, label: '−0.25', color: 'bg-red-400 text-white' },
  { value: 0, label: '0', color: 'bg-secondary text-foreground' },
  { value: 0.25, label: '+0.25', color: 'bg-green-400 text-white' },
  { value: 0.5, label: '+0.5', color: 'bg-green-600 text-white' },
];

function snapScore(raw: number): number {
  const snapped = SCORE_PILLS.reduce((prev, cur) =>
    Math.abs(cur.value - raw) < Math.abs(prev.value - raw) ? cur : prev
  );
  return snapped.value;
}

interface Props {
  productId: string;
}

export default function BreakerzBetsDebrief({ productId }: Props) {
  const router = useRouter();
  const [narrative, setNarrative] = useState('');
  const [status, setStatus] = useState<'idle' | 'parsing' | 'reviewing' | 'done' | 'error'>('idle');
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  async function handleParse() {
    if (!narrative.trim()) return;
    setStatus('parsing');
    setError(null);
    setRows([]);

    try {
      const res = await fetch('/api/admin/parse-bets-debrief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, narrative }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.results?.length) {
        setError('No players were identified in this narrative. Try mentioning specific player names.');
        setStatus('idle');
        return;
      }

      setRows(data.results.map((r: ParsedResult) => ({
        ...r,
        score: snapScore(r.suggested_score),
        note: r.reason_note,
        included: r.confidence >= 0.5,
        is_rookie: false,
      })));
      setStatus('reviewing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }

  async function handleSave() {
    const toSave = rows.filter(r => r.included);
    if (!toSave.length) return;
    setSaving(true);
    setError(null);

    const result = await saveBreakerzBets(
      productId,
      toSave.map(r => ({ playerProductId: r.player_product_id, score: r.score, note: r.note }))
    );

    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }

    setSavedCount(result.saved);
    setStatus('done');
    router.refresh();
  }

  function updateRow(idx: number, patch: Partial<ReviewRow>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  const includedCount = rows.filter(r => r.included).length;

  if (status === 'done') {
    return (
      <div className="space-y-3">
        <div className="rounded border border-green-200 bg-green-50 dark:bg-green-950/20 p-4 flex items-center justify-between">
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            {savedCount} Breakerz Bet{savedCount !== 1 ? 's' : ''} saved.
          </p>
          <button
            onClick={() => { setStatus('idle'); setNarrative(''); setRows([]); setSavedCount(0); }}
            className="text-xs text-green-700 dark:text-green-400 hover:underline font-medium"
          >
            Run another debrief
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Textarea */}
      {(status === 'idle' || status === 'error') && (
        <div className="space-y-3">
          <textarea
            value={narrative}
            onChange={e => setNarrative(e.target.value)}
            placeholder={"Tell us what you're seeing in the market for this product...\n\nExamples: \"Wemby is running hot right now after the playoff run — I'd be a strong buyer. Cade's been quiet, market feels soft. Miller's cards are just sitting, hype hasn't materialized.\""}
            rows={6}
            className="w-full text-sm px-3 py-2.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-[oklch(0.28_0.08_250)] resize-none placeholder:text-muted-foreground/60 leading-relaxed"
          />
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
          <button
            onClick={handleParse}
            disabled={!narrative.trim()}
            className="px-4 py-2 rounded bg-[oklch(0.28_0.08_250)] text-white text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Parse Debrief →
          </button>
        </div>
      )}

      {/* Parsing state */}
      {status === 'parsing' && (
        <div className="rounded border bg-card p-5 text-center space-y-2">
          <p className="text-sm font-medium">Reading your debrief…</p>
          <p className="text-xs text-muted-foreground">Matching players and scoring sentiment</p>
          <div className="mt-3 h-1 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-[oklch(0.28_0.08_250)] animate-pulse w-full" />
          </div>
        </div>
      )}

      {/* Review table */}
      {status === 'reviewing' && rows.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Review Claude{"\u2019"}s interpretation. Edit scores and notes, uncheck any you want to skip, then apply.
          </p>
          <div className="rounded border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Player</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Score</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Reason</th>
                  <th className="px-3 py-2 font-semibold text-muted-foreground text-center">Include</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row, idx) => (
                  <tr key={row.player_product_id} className={row.included ? '' : 'opacity-40'}>
                    {/* Player */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{row.player_name}</span>
                        {row.is_rookie && (
                          <span className="text-[8px] font-black px-1 py-0.5 rounded bg-[var(--topps-red)] text-white uppercase">RC</span>
                        )}
                        {row.confidence < 0.7 && (
                          <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700 uppercase">Review</span>
                        )}
                      </div>
                    </td>

                    {/* Score pills */}
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1">
                        {SCORE_PILLS.map(p => (
                          <button
                            key={p.value}
                            onClick={() => updateRow(idx, { score: p.value })}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-opacity ${
                              row.score === p.value ? p.color : 'bg-secondary text-muted-foreground opacity-50 hover:opacity-80'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </td>

                    {/* Reason note */}
                    <td className="px-3 py-2.5">
                      <input
                        type="text"
                        value={row.note}
                        onChange={e => updateRow(idx, { note: e.target.value })}
                        className="w-full text-xs px-2 py-1 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-[oklch(0.28_0.08_250)]"
                      />
                    </td>

                    {/* Include checkbox */}
                    <td className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={row.included}
                        onChange={e => updateRow(idx, { included: e.target.checked })}
                        className="cursor-pointer"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => { setStatus('idle'); setRows([]); }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Edit narrative
            </button>
            <button
              onClick={handleSave}
              disabled={includedCount === 0 || saving}
              className="px-4 py-2 rounded bg-[oklch(0.28_0.08_250)] text-white text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : `Apply ${includedCount} update${includedCount !== 1 ? 's' : ''} →`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
