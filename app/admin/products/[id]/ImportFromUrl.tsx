'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ParsedChecklist, ParsedOdds } from '@/lib/checklist-parser';
import { computePlayerAggregates, type SectionInput } from '@/lib/checklist-aggregates';

// Inline UD / O-Pee-Chee importer with two surface paths to the same
// underlying parser:
//
//   1. **XLSX upload (preferred)** — Beckett publishes a one-file XLSX
//      whose "Master Card List" sheet is the canonical record of every
//      (parallel × player) row PLUS the multi-format odds. Drop the file
//      → parser extracts both checklist + odds in one pass → writers
//      apply them.
//
//   2. **URL scrape (fallback)** — for when admin doesn't have the XLSX.
//      Firecrawl scrapes upperdeck.com/checklist/<slug>/, the parser
//      reads the same shape, and the 5-min URL cache lets back-to-back
//      checklist + odds imports against the same URL only spend one
//      Firecrawl call.
//
// Both paths land in the same /api/admin/import-checklist +
// /api/admin/apply-odds writers — defaults to 1 hobby set / 0 BD per
// section (UD breakers overwhelmingly sell hobby slots).

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

async function applyParsedChecklist(productId: string, checklist: ParsedChecklist): Promise<ChecklistResult> {
  const sections: SectionInput[] = checklist.sections.map(s => ({
    sectionName: s.sectionName,
    hobbySets: 1,
    bdSets: 0,
    cards: s.cards,
  }));
  const playersOverride = computePlayerAggregates(sections);
  const res = await fetch('/api/admin/import-checklist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, sections, playersOverride }),
  });
  const json = (await res.json()) as ChecklistResult & { error?: string };
  if (!res.ok || json.error) throw new Error(json.error ?? `Import failed (${res.status})`);
  return json;
}

async function applyParsedOdds(productId: string, odds: ParsedOdds): Promise<OddsResult> {
  const res = await fetch('/api/admin/apply-odds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, odds }),
  });
  const json = (await res.json()) as OddsResult & { error?: string };
  if (!res.ok || json.error) throw new Error(json.error ?? `Apply failed (${res.status})`);
  return json;
}

export default function ImportFromUrl({ productId }: { productId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [checklistUrl, setChecklistUrl] = useState('');
  const [oddsUrl, setOddsUrl] = useState('');
  const [busy, setBusy] = useState<'xlsx' | 'checklist-url' | 'odds-url' | null>(null);
  const [checklistResult, setChecklistResult] = useState<ChecklistResult | null>(null);
  const [oddsResult, setOddsResult] = useState<OddsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importXlsx(file: File) {
    setBusy('xlsx');
    setError(null);
    setChecklistResult(null);
    setOddsResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const parseRes = await fetch('/api/admin/parse-upper-deck-xlsx', {
        method: 'POST',
        body: form,
      });
      const parseJson = (await parseRes.json()) as {
        checklist?: ParsedChecklist;
        odds?: ParsedOdds;
        error?: string;
      };
      if (!parseRes.ok || parseJson.error || !parseJson.checklist || !parseJson.odds) {
        throw new Error(parseJson.error ?? `Parse failed (${parseRes.status})`);
      }
      const cr = await applyParsedChecklist(productId, parseJson.checklist);
      setChecklistResult(cr);
      const or = await applyParsedOdds(productId, parseJson.odds);
      setOddsResult(or);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function importChecklistUrl() {
    setBusy('checklist-url');
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
      const cr = await applyParsedChecklist(productId, parseJson.checklist);
      setChecklistResult(cr);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }

  async function importOddsUrl() {
    setBusy('odds-url');
    setError(null);
    setOddsResult(null);
    try {
      const parseRes = await fetch('/api/admin/parse-odds-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: oddsUrl.trim() }),
      });
      const parseJson = (await parseRes.json()) as { odds?: ParsedOdds; error?: string };
      if (!parseRes.ok || parseJson.error || !parseJson.odds) {
        throw new Error(parseJson.error ?? `Parse failed (${parseRes.status})`);
      }
      const or = await applyParsedOdds(productId, parseJson.odds);
      setOddsResult(or);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;
  const inputStyle = {
    backgroundColor: 'var(--terminal-surface)',
    borderColor: 'var(--terminal-border)',
    color: 'var(--text-primary)',
  };
  const btnStyle = { borderColor: 'var(--terminal-border)', color: 'var(--text-secondary)' };

  return (
    <div className="space-y-5">
      {/* XLSX upload — preferred path */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <label className="terminal-label-muted">Beckett XLSX (preferred)</label>
          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            One file → checklist + odds in one pass
          </span>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Drop the Beckett-published <code>2025-26-…-Checklist.xlsx</code>. The parser reads the
          <code>Master Card List</code> sheet for every (parallel × player) row plus the multi-format
          odds.
        </p>
        <label
          className="inline-flex items-center gap-2 cursor-pointer rounded border px-3 py-1.5 text-sm font-medium hover:bg-[var(--terminal-surface-hover)]"
          style={btnStyle}
        >
          {busy === 'xlsx' ? 'Importing…' : 'Upload XLSX →'}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={disabled}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) importXlsx(file);
            }}
          />
        </label>
      </div>

      <div className="border-t pt-4 space-y-3" style={{ borderColor: 'var(--terminal-border)' }}>
        <div className="flex items-baseline justify-between gap-2">
          <label className="terminal-label-muted">Or fall back to URL scraping</label>
          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            Scrapes <code>upperdeck.com/checklist/…</code> via Firecrawl
          </span>
        </div>

        <div>
          <label className="terminal-label-muted block mb-1">Checklist URL</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={checklistUrl}
              onChange={e => setChecklistUrl(e.target.value)}
              placeholder="https://upperdeck.com/checklist/…"
              className="flex-1 rounded border px-3 py-1.5 text-sm font-mono"
              style={inputStyle}
              disabled={disabled}
            />
            <button
              onClick={importChecklistUrl}
              disabled={disabled || !checklistUrl.trim()}
              className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-40 hover:bg-[var(--terminal-surface-hover)]"
              style={btnStyle}
            >
              {busy === 'checklist-url' ? 'Importing…' : 'Import →'}
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
              style={inputStyle}
              disabled={disabled}
            />
            <button
              onClick={importOddsUrl}
              disabled={disabled || !oddsUrl.trim()}
              className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-40 hover:bg-[var(--terminal-surface-hover)]"
              style={btnStyle}
            >
              {busy === 'odds-url' ? 'Applying…' : 'Import →'}
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
