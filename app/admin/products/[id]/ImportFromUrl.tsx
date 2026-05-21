'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ParsedChecklist } from '@/lib/checklist-parser';
import { computePlayerAggregates, type SectionInput } from '@/lib/checklist-aggregates';

// Inline "Import from URL" panel for Upper Deck checklist pages.
//
// Two side-by-side flows that share a 5-min server cache so back-to-back
// checklist + odds imports against the same URL only spend one Firecrawl
// scrape:
//
//   1. Import checklist — POST /api/admin/parse-checklist-url, then forward
//      the ParsedChecklist to /api/admin/import-checklist with default
//      { hobbySets: 1, bdSets: 0 } per section (UD is hobby-only). Admin
//      can adjust per-section sets afterward via the legacy wizard if
//      they need a non-default mix.
//
//   2. Import odds — POST /api/admin/parse-odds-url, then forward the
//      ParsedOdds to /api/admin/apply-odds (the existing token-overlap
//      matcher).

type ChecklistResult = {
  playersCreated: number;
  playerProductsCreated: number;
  variantsCreated: number;
  variantsSkippedAsDuplicates?: number;
};

type OddsResult = {
  updatedCount: number;
  matched: { subsetName: string; variantName: string; hobbyOdds: string; breakerOdds: string | null }[];
  unmatched: string[];
};

export default function ImportFromUrl({ productId }: { productId: string }) {
  const router = useRouter();
  const [checklistUrl, setChecklistUrl] = useState('');
  const [oddsUrl, setOddsUrl] = useState('');
  const [busy, setBusy] = useState<'checklist' | 'odds' | null>(null);
  const [checklistResult, setChecklistResult] = useState<ChecklistResult | null>(null);
  const [oddsResult, setOddsResult] = useState<OddsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importChecklist() {
    setBusy('checklist');
    setError(null);
    setChecklistResult(null);
    try {
      const parseRes = await fetch('/api/admin/parse-checklist-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: checklistUrl.trim() }),
      });
      const parseJson = (await parseRes.json()) as { checklist?: ParsedChecklist; error?: string };
      if (!parseRes.ok || parseJson.error || !parseJson.checklist) {
        throw new Error(parseJson.error ?? `Parse failed (${parseRes.status})`);
      }

      // Default to 1 hobby set / 0 BD sets per section — UD breakers
      // overwhelmingly sell hobby slots. Admin can adjust later via the
      // legacy /admin/import-checklist wizard if needed.
      const sections: SectionInput[] = parseJson.checklist.sections.map(s => ({
        sectionName: s.sectionName,
        hobbySets: 1,
        bdSets: 0,
        cards: s.cards,
      }));

      const playersOverride = computePlayerAggregates(sections);

      const applyRes = await fetch('/api/admin/import-checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, sections, playersOverride }),
      });
      const applyJson = (await applyRes.json()) as ChecklistResult & { error?: string };
      if (!applyRes.ok || applyJson.error) {
        throw new Error(applyJson.error ?? `Import failed (${applyRes.status})`);
      }
      setChecklistResult(applyJson);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }

  async function importOdds() {
    setBusy('odds');
    setError(null);
    setOddsResult(null);
    try {
      const parseRes = await fetch('/api/admin/parse-odds-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: oddsUrl.trim() }),
      });
      const parseJson = (await parseRes.json()) as { odds?: unknown; error?: string };
      if (!parseRes.ok || parseJson.error || !parseJson.odds) {
        throw new Error(parseJson.error ?? `Parse failed (${parseRes.status})`);
      }
      const applyRes = await fetch('/api/admin/apply-odds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, odds: parseJson.odds }),
      });
      const applyJson = (await applyRes.json()) as OddsResult & { error?: string };
      if (!applyRes.ok || applyJson.error) {
        throw new Error(applyJson.error ?? `Apply failed (${applyRes.status})`);
      }
      setOddsResult(applyJson);
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
        Upper Deck publishes per-release checklists at <code>upperdeck.com/checklist/…</code>.
        Paste the URL — Firecrawl scrapes the table, Claude normalizes the multi-format odds
        column. Back-to-back checklist + odds imports against the same URL only hit Firecrawl
        once (5-min cache).
      </p>

      <div className="space-y-3">
        <div>
          <label className="terminal-label-muted block mb-1">Checklist URL</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={checklistUrl}
              onChange={e => setChecklistUrl(e.target.value)}
              placeholder="https://upperdeck.com/checklist/…"
              className="flex-1 rounded border px-3 py-1.5 text-sm font-mono"
              style={{
                backgroundColor: 'var(--terminal-surface)',
                borderColor: 'var(--terminal-border)',
                color: 'var(--text-primary)',
              }}
              disabled={disabled}
            />
            <button
              onClick={importChecklist}
              disabled={disabled || !checklistUrl.trim()}
              className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-40 hover:bg-[var(--terminal-surface-hover)]"
              style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-secondary)' }}
            >
              {busy === 'checklist' ? 'Importing…' : 'Import →'}
            </button>
          </div>
        </div>

        <div>
          <label className="terminal-label-muted block mb-1">Odds URL</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={oddsUrl}
              onChange={e => setOddsUrl(e.target.value)}
              placeholder="Often the same as Checklist URL"
              className="flex-1 rounded border px-3 py-1.5 text-sm font-mono"
              style={{
                backgroundColor: 'var(--terminal-surface)',
                borderColor: 'var(--terminal-border)',
                color: 'var(--text-primary)',
              }}
              disabled={disabled}
            />
            <button
              onClick={importOdds}
              disabled={disabled || !oddsUrl.trim()}
              className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-40 hover:bg-[var(--terminal-surface-hover)]"
              style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-secondary)' }}
            >
              {busy === 'odds' ? 'Applying…' : 'Import →'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div
          className="rounded border p-2 text-xs"
          style={{ borderColor: 'rgba(239, 68, 68, 0.4)', backgroundColor: 'rgba(239, 68, 68, 0.08)', color: '#fca5a5' }}
        >
          {error}
        </div>
      )}

      {checklistResult && (
        <div className="text-xs space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
          <p>
            <span style={{ color: 'var(--signal-buy)' }}>Checklist imported · </span>
            {checklistResult.playersCreated} players, {checklistResult.playerProductsCreated} player_products,{' '}
            {checklistResult.variantsCreated} variants
            {checklistResult.variantsSkippedAsDuplicates
              ? ` (+${checklistResult.variantsSkippedAsDuplicates} dedup-skipped)`
              : ''}
          </p>
          <p style={{ color: 'var(--text-tertiary)' }}>
            Default 1 hobby set / 0 BD per section. Adjust per-section via{' '}
            <code>/admin/import-checklist?productId={productId}</code> if needed.
          </p>
        </div>
      )}

      {oddsResult && (
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          <p>
            <span style={{ color: 'var(--signal-buy)' }}>Odds applied · </span>
            {oddsResult.matched.length} matched · {oddsResult.unmatched.length} unmatched
          </p>
          {oddsResult.unmatched.length > 0 && (
            <p style={{ color: 'var(--text-tertiary)' }}>
              Unmatched: {oddsResult.unmatched.slice(0, 5).join(', ')}
              {oddsResult.unmatched.length > 5 ? '…' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
