'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LatestSnapshot } from '@/lib/waxstat-importer';

type Format = 'hobby' | 'bd' | 'jumbo';
const FORMATS: Format[] = ['hobby', 'bd', 'jumbo'];
const FORMAT_LABEL: Record<Format, string> = { hobby: 'Hobby', bd: 'BD', jumbo: 'Jumbo' };

type RefreshSummary = {
  productId: string;
  attempted: number;
  ok: number;
  errors: number;
  perFormat: Record<Format, { url: string | null; ok: boolean; error?: string; avgPrice?: number | null }>;
};

export default function WaxstatPanel({
  productId,
  initialUrls,
  initialSnapshots,
}: {
  productId: string;
  initialUrls: Record<Format, string | null>;
  initialSnapshots: LatestSnapshot[];
}) {
  const router = useRouter();
  const [urls, setUrls] = useState<Record<Format, string>>({
    hobby: initialUrls.hobby ?? '',
    bd: initialUrls.bd ?? '',
    jumbo: initialUrls.jumbo ?? '',
  });
  const [snapshots, setSnapshots] = useState<LatestSnapshot[]>(initialSnapshots);
  const [busy, setBusy] = useState<'save' | 'refresh' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const snapByFormat = new Map(snapshots.map(s => [s.format, s]));

  async function save() {
    setBusy('save');
    setError(null);
    try {
      const res = await fetch(`/api/admin/products/${productId}/waxstat-refresh`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hobbyUrl: urls.hobby || null,
          bdUrl: urls.bd || null,
          jumboUrl: urls.jumbo || null,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `Save failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setBusy('refresh');
    setError(null);
    try {
      const res = await fetch(`/api/admin/products/${productId}/waxstat-refresh`, {
        method: 'POST',
      });
      const json = (await res.json()) as RefreshSummary & { error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `Refresh failed (${res.status})`);
      // Build snapshot rows from the result so we don't need a router.refresh round-trip.
      const fresh: LatestSnapshot[] = FORMATS.flatMap(fmt => {
        const r = json.perFormat[fmt];
        if (!r.url) return [];
        return [
          {
            format: fmt,
            source_url: r.url,
            avg_price: r.ok ? (r.avgPrice ?? null) : null,
            low_30d: null,
            high_30d: null,
            trend_7d: null,
            error_message: r.ok ? null : r.error ?? null,
            fetched_at: new Date().toISOString(),
          },
        ];
      });
      // Merge: prefer fresh rows, retain older formats not touched.
      const merged = new Map<Format, LatestSnapshot>();
      for (const row of snapshots) merged.set(row.format, row);
      for (const row of fresh) merged.set(row.format, row);
      setSnapshots(Array.from(merged.values()));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        Paste a WaxStat product URL per format to track sealed-box pricing. The Sunday 04:00 UTC
        cron pulls fresh values weekly; on success the avg price overwrites <code>*_am_case_cost</code>
        on this product. Errors are logged as snapshot rows so stale ≠ broken.
      </p>

      <div className="space-y-2">
        {FORMATS.map(fmt => {
          const snap = snapByFormat.get(fmt);
          return (
            <div key={fmt} className="grid grid-cols-[80px_1fr] gap-2 items-center">
              <label className="terminal-label-muted text-xs">{FORMAT_LABEL[fmt]}</label>
              <input
                type="url"
                value={urls[fmt]}
                onChange={e => setUrls(prev => ({ ...prev, [fmt]: e.target.value }))}
                placeholder={`https://waxstat.com/… (${fmt})`}
                className="w-full rounded border px-3 py-1.5 text-sm font-mono"
                style={{
                  backgroundColor: 'var(--terminal-surface)',
                  borderColor: 'var(--terminal-border)',
                  color: 'var(--text-primary)',
                }}
                disabled={disabled}
              />
              <div className="col-start-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {snap ? (
                  snap.error_message ? (
                    <span style={{ color: '#fca5a5' }}>
                      Last refresh {new Date(snap.fetched_at).toLocaleString()}: {snap.error_message}
                    </span>
                  ) : (
                    <span>
                      Last refresh {new Date(snap.fetched_at).toLocaleString()}: avg ${snap.avg_price?.toFixed(2) ?? '—'}
                      {snap.low_30d != null && snap.high_30d != null
                        ? ` (30d ${snap.low_30d.toFixed(0)}–${snap.high_30d.toFixed(0)})`
                        : ''}
                      {snap.trend_7d != null ? ` · 7d ${snap.trend_7d > 0 ? '+' : ''}${snap.trend_7d}%` : ''}
                    </span>
                  )
                ) : (
                  <span>No snapshots yet</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={disabled}
          className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-40 hover:bg-[var(--terminal-surface-hover)]"
          style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-secondary)' }}
        >
          {busy === 'save' ? 'Saving…' : 'Save URLs'}
        </button>
        <button
          onClick={refresh}
          disabled={disabled}
          className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-40 hover:bg-[var(--terminal-surface-hover)]"
          style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-secondary)' }}
        >
          {busy === 'refresh' ? 'Refreshing…' : 'Refresh Now'}
        </button>
        {error && (
          <span className="text-xs" style={{ color: '#fca5a5' }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
