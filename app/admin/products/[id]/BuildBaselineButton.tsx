'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildPreReleaseBaseline } from '../actions';
import { errText } from '@/lib/format-error';
import type { BaselineResult } from '@/lib/pre-release-baseline';

// Pre-release Phase 1 — "Build pre-release baseline". Preview (compute only)
// then Build (persist). See docs/plans/2026-08-14-pre-release-pricing.md.
export default function BuildBaselineButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<BaselineResult | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  async function run(write: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await buildPreReleaseBaseline(productId, write);
      if (res.error) { setMsg({ kind: 'error', text: errText(res.error, 'Failed') }); return; }
      if (write) {
        setPreview(null);
        setMsg({ kind: 'ok', text: `Wrote baselines for ${res.written} players. Sentiment adjusts from here.` });
        router.refresh();
      } else {
        setPreview(res.result ?? null);
      }
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e, 'Failed') });
    } finally {
      setBusy(false);
    }
  }

  const s = preview?.summary;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => run(false)}
          disabled={busy}
          className="h-9 px-3 rounded-lg text-sm font-medium disabled:opacity-40"
          style={{ border: '1px solid var(--terminal-border)', color: 'var(--text-secondary)' }}
        >
          {busy && !preview ? 'Computing…' : 'Preview baseline'}
        </button>
        {preview && (
          <button
            onClick={() => run(true)}
            disabled={busy}
            className="h-9 px-3 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: 'var(--accent-blue)' }}
          >
            {busy ? 'Writing…' : `Build (${preview.rows.length})`}
          </button>
        )}
      </div>

      {msg && (
        <p className="text-xs" style={{ color: msg.kind === 'error' ? '#ef4444' : '#10b981' }}>{msg.text}</p>
      )}

      {s && (
        <div
          className="rounded-lg border p-3 space-y-2"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {s.total} players · <b>{s.previous_product}</b> from previous cycle
            {!preview?.previousProductLinked && ' (no prior product linked)'} ·{' '}
            <b>{s.raw_comp}</b> from 90d comp · <b>{s.rookie_floor}</b> rookie floor · <b>{s.floor}</b> floor (no comp)
          </p>
          <div className="max-h-56 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--text-tertiary)' }}>
                  <th className="text-left font-medium py-1">Player</th>
                  <th className="text-left font-medium">Team</th>
                  <th className="text-right font-medium">Baseline</th>
                  <th className="text-left font-medium pl-3">Source</th>
                </tr>
              </thead>
              <tbody>
                {[...preview!.rows]
                  .sort((a, b) => b.baseline - a.baseline)
                  .slice(0, 40)
                  .map(r => (
                    <tr key={r.playerProductId} style={{ color: 'var(--text-secondary)' }}>
                      <td className="py-0.5">{r.name}{r.isRookie ? ' · RC' : ''}</td>
                      <td>{r.team || '—'}</td>
                      <td className="text-right font-mono">${r.baseline.toLocaleString()}</td>
                      <td className="pl-3" style={{ color: 'var(--text-tertiary)' }}>{r.source}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {preview!.rows.length > 40 && (
              <p className="text-[11px] pt-1" style={{ color: 'var(--text-tertiary)' }}>+ {preview!.rows.length - 40} more (top 40 by baseline shown)</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
