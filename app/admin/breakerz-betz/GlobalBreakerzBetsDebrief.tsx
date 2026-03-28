'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveBreakerzBetsGlobal } from './actions';

interface ParsedResult {
  player_id: string;
  player_name: string;
  suggested_score: number;
  reason_note: string;
  confidence: number;
}

interface ReviewRow extends ParsedResult {
  score: number;
  note: string;
  included: boolean;
}

const SCORE_PILLS = [
  { value: -0.5, label: '−0.5', color: 'bg-red-600 text-white' },
  { value: -0.25, label: '−0.25', color: 'bg-red-400 text-white' },
  { value: 0, label: '0', color: 'bg-secondary text-foreground' },
  { value: 0.25, label: '+0.25', color: 'bg-green-400 text-white' },
  { value: 0.5, label: '+0.5', color: 'bg-green-600 text-white' },
];

function snapScore(raw: number): number {
  return SCORE_PILLS.reduce((prev, cur) =>
    Math.abs(cur.value - raw) < Math.abs(prev.value - raw) ? cur : prev
  ).value;
}

export default function GlobalBreakerzBetsDebrief() {
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
      const res = await fetch('/api/admin/parse-bets-global', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ narrative }),
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

    const result = await saveBreakerzBetsGlobal(
      toSave.map(r => ({ playerId: r.player_id, score: r.score, note: r.note }))
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
      <div
        className="rounded-xl border p-5"
        style={{ backgroundColor: 'rgba(34, 197, 94, 0.05)', borderColor: 'rgba(34, 197, 94, 0.3)' }}
      >
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--signal-buy)' }}>
          {savedCount} player{savedCount !== 1 ? 's' : ''} updated across all products.
        </p>
        <button
          onClick={() => { setStatus('idle'); setNarrative(''); setRows([]); setSavedCount(0); }}
          className="px-4 py-2 rounded-lg text-sm font-bold transition-all"
          style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)', color: 'var(--signal-buy)', border: '1px solid rgba(34, 197, 94, 0.3)' }}
        >
          Run another debrief
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(status === 'idle' || status === 'error') && (
        <div className="space-y-3">
          <textarea
            value={narrative}
            onChange={e => setNarrative(e.target.value)}
            placeholder={"Share your current market read across any players...\n\nExamples: \"Wemby is running hot after the playoff push — strong buyer here. Ohtani cards feel overvalued at current prices. CJ Stroud looks like the sleeper of the year.\""}
            rows={6}
            className="w-full text-sm px-3 py-2.5 rounded-lg border resize-none leading-relaxed focus:outline-none"
            style={{
              backgroundColor: 'var(--terminal-surface)',
              borderColor: 'var(--terminal-border-hover)',
              color: 'var(--text-primary)',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--terminal-border-hover)'; }}
          />
          {error && (
            <p className="text-sm" style={{ color: 'var(--signal-pass)' }}>{error}</p>
          )}
          <button
            onClick={handleParse}
            disabled={!narrative.trim()}
            className="px-5 py-2.5 rounded-lg text-white text-sm font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)', boxShadow: '0 0 20px rgba(168, 85, 247, 0.3)' }}
          >
            Parse with Claude →
          </button>
        </div>
      )}

      {status === 'parsing' && (
        <div
          className="rounded-xl border p-6 text-center space-y-2"
          style={{ backgroundColor: 'var(--terminal-surface)', borderColor: 'var(--terminal-border)' }}
        >
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Reading your debrief across all players…
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Matching players and scoring sentiment globally
          </p>
          <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--terminal-surface-active)' }}>
            <div className="h-full animate-pulse w-full" style={{ background: 'linear-gradient(90deg, #a855f7, #ec4899)' }} />
          </div>
        </div>
      )}

      {status === 'reviewing' && rows.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Review Claude's interpretation. These scores will be applied across all products each player appears in.
          </p>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--terminal-border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-tertiary)' }}>
                  <th className="text-left px-4 py-2.5 font-bold uppercase tracking-wider">Player</th>
                  <th className="text-left px-4 py-2.5 font-bold uppercase tracking-wider">Score</th>
                  <th className="text-left px-4 py-2.5 font-bold uppercase tracking-wider">Reason</th>
                  <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-center">Include</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
                {rows.map((row, idx) => (
                  <tr
                    key={row.player_id}
                    style={{ backgroundColor: 'var(--terminal-surface)', opacity: row.included ? 1 : 0.4 }}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{row.player_name}</span>
                        {row.confidence < 0.7 && (
                          <span className="text-[8px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(245,158,11,0.15)', color: 'var(--signal-watch)' }}>
                            Review
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
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
                    <td className="px-4 py-2.5">
                      <input
                        type="text"
                        value={row.note}
                        onChange={e => updateRow(idx, { note: e.target.value })}
                        className="w-full text-xs px-2 py-1 rounded border focus:outline-none"
                        style={{ backgroundColor: 'var(--terminal-surface-hover)', borderColor: 'var(--terminal-border)', color: 'var(--text-primary)' }}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-center">
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
              className="text-xs transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              ← Edit narrative
            </button>
            <button
              onClick={handleSave}
              disabled={includedCount === 0 || saving}
              className="px-5 py-2.5 rounded-lg text-white text-sm font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)' }}
            >
              {saving ? 'Saving…' : `Apply ${includedCount} update${includedCount !== 1 ? 's' : ''} globally →`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
