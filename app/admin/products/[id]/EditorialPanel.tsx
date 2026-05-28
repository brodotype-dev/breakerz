'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { errText } from '@/lib/format-error';

interface UrlResult {
  url: string;
  ok: boolean;
  written: number;
  superseded: number;
  error?: string;
}

interface RefreshSummary {
  productId: string;
  urlCount: number;
  totalWritten: number;
  results: UrlResult[];
}

/**
 * Bucket A (web-sourced-intel Slice 3). Admin pastes editorial / content
 * URLs (one per line) — Beckett product news, Topps blog, break previews,
 * etc. "Re-scrape" Firecrawls each, extracts product/team/player hype +
 * sentiment via Claude, and writes them directly to market_observations
 * (no Discord proposal — the admin is the gate). Re-scrape supersedes the
 * prior observations from each URL, so it replaces rather than stacks.
 */
export default function EditorialPanel({
  productId,
  initialUrls,
}: {
  productId: string;
  initialUrls: string[];
}) {
  const router = useRouter();
  const [text, setText] = useState(initialUrls.join('\n'));
  const [busy, setBusy] = useState<'save' | 'refresh' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RefreshSummary | null>(null);

  const urls = text
    .split('\n')
    .map(u => u.trim())
    .filter(Boolean);

  async function save() {
    setBusy('save');
    setError(null);
    try {
      const res = await fetch(`/api/admin/products/${productId}/editorial-refresh`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.error) throw new Error(errText(json?.error, `Save failed (${res.status})`));
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
    setSummary(null);
    try {
      const res = await fetch(`/api/admin/products/${productId}/editorial-refresh`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.error) throw new Error(errText(json?.error, `Refresh failed (${res.status})`));
      setSummary(json as RefreshSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        One editorial/content URL per line (Beckett product news, Topps blog, break previews…).
        Save, then Re-scrape to extract product/team/player hype + sentiment into{' '}
        <code>market_observations</code> — written directly with per-URL attribution, no Discord
        proposal. Re-scraping supersedes the prior rows from each URL.
      </p>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={Math.max(3, urls.length + 1)}
        placeholder={'https://www.beckett.com/news/…\nhttps://www.topps.com/blogs/…'}
        className="w-full rounded border px-3 py-2 text-sm font-mono"
        style={{
          backgroundColor: 'var(--terminal-surface)',
          borderColor: 'var(--terminal-border)',
          color: 'var(--text-primary)',
        }}
        disabled={disabled}
      />

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={disabled}
          className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-40 hover:bg-[var(--terminal-surface-hover)]"
          style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-secondary)' }}
        >
          {busy === 'save' ? 'Saving…' : `Save URLs (${urls.length})`}
        </button>
        <button
          onClick={refresh}
          disabled={disabled || urls.length === 0}
          className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-40 hover:bg-[var(--terminal-surface-hover)]"
          style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-secondary)' }}
        >
          {busy === 'refresh' ? 'Scraping…' : 'Re-scrape editorial'}
        </button>
        {error && <span className="text-xs" style={{ color: '#fca5a5' }}>{error}</span>}
      </div>

      {summary && (
        <div className="text-xs space-y-1" style={{ color: 'var(--text-tertiary)' }}>
          <div>
            {summary.totalWritten} observation{summary.totalWritten === 1 ? '' : 's'} written across{' '}
            {summary.urlCount} URL{summary.urlCount === 1 ? '' : 's'}.
          </div>
          <ul className="space-y-0.5">
            {summary.results.map((r, i) => (
              <li key={i}>
                {r.ok ? (
                  <span>
                    ✓ {r.written} written{r.superseded > 0 ? `, ${r.superseded} superseded` : ''} —{' '}
                    <span className="font-mono">{r.url}</span>
                  </span>
                ) : (
                  <span style={{ color: '#fca5a5' }}>
                    ✗ {r.error} — <span className="font-mono">{r.url}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
