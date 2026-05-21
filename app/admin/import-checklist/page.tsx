'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { ParsedChecklist, ParsedSection } from '@/lib/checklist-parser';
import { computePlayerAggregates } from '@/lib/checklist-aggregates';
import UpperDeckImporter from '@/components/admin/UpperDeckImporter';

// ─── Types ───────────────────────────────────────────────────────────────────

type Product = { id: string; name: string; slug: string; manufacturer: string };

// Upper Deck-family products use a manufacturer-specific importer
// (Beckett XLSX or upperdeck.com URL scrape) — see
// docs/manufacturer-rules/upper-deck.md. The legacy Topps/Bowman/Panini
// wizard stays unchanged for everything else.
const UD_MANUFACTURERS = new Set(['Upper Deck', 'O-Pee-Chee']);

type SectionConfig = {
  sectionName: string;
  hobbySets: number;
  bdSets: number;
  include: boolean;
  cardCount: number;
  flaggedCount: number;
  expanded: boolean;
  cards: ParsedSection['cards'];
  flagged: string[];
};

type ImportResult = {
  playersCreated: number;
  playerProductsCreated: number;
  variantsCreated: number;
  variantsSkippedAsDuplicates?: number;
};

type ImportProgress = {
  totalBatches: number;
  completedBatches: number;
  totalCards: number;
  cardsImported: number;
};

type MatchRow = {
  variantId: string;
  playerName: string;
  variantName: string;
  cardNumber: string | null;
  cardId: string | null;
  confidence: number;
  status: 'auto' | 'review' | 'no-match';
};

type Step = 'upload' | 'review' | 'result';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function confidenceColor(status: MatchRow['status']) {
  if (status === 'auto') return 'text-green-600';
  if (status === 'review') return 'text-yellow-600';
  return 'text-red-500';
}

// Coerce any API error value to a renderable string. Server JSON sometimes
// hands back `error` as an object (Postgres / Anthropic / nested envelopes);
// rendering that directly as a React child throws #31.
function asErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    try { return JSON.stringify(value); } catch { return fallback; }
  }
  return fallback;
}

// ─── Component ───────────────────────────────────────────────────────────────

function ImportChecklistInner() {
  const searchParams = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const oddsFileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState(searchParams.get('productId') ?? '');
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const [sections, setSections] = useState<SectionConfig[]>([]);
  const [productName, setProductName] = useState('');

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  const [matching, setMatching] = useState(false);
  // Progress is surfaced live during the run. Only review/no-match rows
  // accumulate into matchUnmatched — the auto rows are 95%+ of the volume
  // and listing them all (17k+ on Panini Prizm) was making the page useless.
  const [matchProgress, setMatchProgress] = useState<{
    completed: number; total: number; auto: number; review: number; noMatch: number;
  } | null>(null);
  const [matchUnmatched, setMatchUnmatched] = useState<MatchRow[]>([]);
  const [matchDone, setMatchDone] = useState(false);
  const [showMatchDebug, setShowMatchDebug] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);

  const [oddsUploading, setOddsUploading] = useState(false);
  const [oddsError, setOddsError] = useState<string | null>(null);
  const [oddsResult, setOddsResult] = useState<{
    updatedCount: number;
    matched: { subsetName: string; variantName: string; hobbyOdds: string; breakerOdds: string | null }[];
    unmatched: string[];
  } | null>(null);

  // Fetch products on mount
  useEffect(() => {
    fetch('/api/admin/products')
      .then(r => r.json())
      .then(d => setProducts(d.products ?? []))
      .catch(() => {/* ignore — user can still type a product ID */});
  }, []);

  // ── Step 1: Parse ──────────────────────────────────────────────────────────

  async function handleParse() {
    const files = Array.from(fileRef.current?.files ?? []);
    if (!files.length) { setParseError('Select a file first.'); return; }
    if (!productId) { setParseError('Select a product first.'); return; }

    setParseError(null);
    setParsing(true);

    const formData = new FormData();
    for (const file of files) formData.append('file', file);

    try {
      const res = await fetch('/api/admin/parse-checklist', { method: 'POST', body: formData });
      const json = await res.json();

      if (!res.ok || json.error) {
        setParseError(asErrorMessage(json.error, 'Parse failed'));
        setParsing(false);
        return;
      }

      const checklist: ParsedChecklist = json.checklist;
      setProductName(checklist.productName || products.find(p => p.id === productId)?.name || '');
      setSections(
        checklist.sections.map(s => ({
          sectionName: s.sectionName,
          hobbySets: 1,
          bdSets: 0,
          include: true,
          cardCount: s.cards.length,
          flaggedCount: s.flagged.length,
          expanded: false,
          cards: s.cards,
          flagged: s.flagged,
        }))
      );
      setStep('review');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setParsing(false);
    }
  }

  // ── Step 2: Import ─────────────────────────────────────────────────────────
  //
  // Vercel Function ingress hard-caps request bodies at 4.5 MB. Bowman / Topps
  // jumbo checklists with parallels expanded (Panini Prizm Football: 32k+
  // rows) blow past that in a single POST. Strategy:
  //
  // 1. Compute player aggregates locally over the FULL set of included
  //    sections (this is the same logic the server runs; both share
  //    lib/checklist-aggregates.ts).
  // 2. Walk the sections building chunks under MAX_BATCH_CARDS each. Sections
  //    larger than the cap get split — their `cards` array is sliced across
  //    multiple chunks.
  // 3. POST each chunk with the same `playersOverride`, so player +
  //    player_product upserts get the canonical totals every time and don't
  //    drift as chunks land.
  // 4. Server's variant insert is dedupe-aware (SELECT-then-filter on
  //    pp_id + variant_name + card_number), so the chunk that splits a
  //    section doesn't matter for variant correctness — variants from
  //    later chunks just append, no duplicates.

  async function handleImport() {
    const included = sections.filter(s => s.include);
    if (!included.length) { setImportError('Include at least one section.'); return; }

    setImporting(true);
    setImportError(null);
    setImportProgress(null);

    // Cap each batch well below Vercel's 4.5 MB hard limit. Card payload size
    // varies wildly (parallels list dominates) — 8000 cards usually sits
    // around 1.5–3 MB; safe headroom even for parallel-heavy sections.
    const MAX_BATCH_CARDS = 8000;

    type Section = { sectionName: string; hobbySets: number; bdSets: number; cards: ParsedSection['cards'] };
    const flatSections: Section[] = included.map(s => ({
      sectionName: s.sectionName,
      hobbySets: s.hobbySets,
      bdSets: s.bdSets,
      cards: s.cards,
    }));

    // Build batches. Each batch is an array of Section objects whose `cards`
    // arrays sum to ≤ MAX_BATCH_CARDS. A section larger than the cap is split
    // across batches with its metadata replicated.
    const batches: Section[][] = [];
    let current: Section[] = [];
    let currentCards = 0;
    for (const section of flatSections) {
      let cardCursor = 0;
      while (cardCursor < section.cards.length) {
        const remainingInBatch = MAX_BATCH_CARDS - currentCards;
        const take = Math.min(section.cards.length - cardCursor, Math.max(remainingInBatch, 1));
        current.push({
          sectionName: section.sectionName,
          hobbySets: section.hobbySets,
          bdSets: section.bdSets,
          cards: section.cards.slice(cardCursor, cardCursor + take),
        });
        currentCards += take;
        cardCursor += take;
        if (currentCards >= MAX_BATCH_CARDS) {
          batches.push(current);
          current = [];
          currentCards = 0;
        }
      }
    }
    if (current.length > 0) batches.push(current);

    const playersOverride = computePlayerAggregates(flatSections);
    const totalCards = flatSections.reduce((n, s) => n + s.cards.length, 0);

    setImportProgress({
      totalBatches: batches.length,
      completedBatches: 0,
      totalCards,
      cardsImported: 0,
    });

    const aggregate: ImportResult = {
      playersCreated: 0,
      playerProductsCreated: 0,
      variantsCreated: 0,
      variantsSkippedAsDuplicates: 0,
    };

    try {
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchCards = batch.reduce((n, s) => n + s.cards.length, 0);
        const body = {
          productId,
          sections: batch,
          playersOverride,
        };

        const res = await fetch('/api/admin/import-checklist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        // Don't trust json() — Vercel's 413 response is plain text and would
        // throw "Unexpected token 'R'..." which masks the real cause.
        const text = await res.text();
        let json: ImportResult & { error?: string };
        try { json = JSON.parse(text) as ImportResult & { error?: string }; }
        catch {
          if (res.status === 413) {
            setImportError(`Batch ${i + 1}/${batches.length} exceeded the 4.5 MB request limit. Try lowering MAX_BATCH_CARDS.`);
          } else {
            setImportError(`Server returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
          }
          setImporting(false);
          return;
        }

        if (!res.ok || json.error) {
          setImportError(`Batch ${i + 1}/${batches.length}: ${asErrorMessage(json.error, `HTTP ${res.status}`)}`);
          setImporting(false);
          return;
        }

        aggregate.playersCreated = Math.max(aggregate.playersCreated, json.playersCreated);
        aggregate.playerProductsCreated = Math.max(aggregate.playerProductsCreated, json.playerProductsCreated);
        aggregate.variantsCreated += json.variantsCreated;
        aggregate.variantsSkippedAsDuplicates =
          (aggregate.variantsSkippedAsDuplicates ?? 0) + (json.variantsSkippedAsDuplicates ?? 0);

        setImportProgress(prev => prev && {
          ...prev,
          completedBatches: i + 1,
          cardsImported: prev.cardsImported + batchCards,
        });
      }

      setImportResult(aggregate);
      setStep('result');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setImporting(false);
    }
  }

  // ── Step 3: Match CardHedger ───────────────────────────────────────────────
  //
  // The match endpoint chunks server-side (default 40 variants per call) and
  // returns `hasMore + nextOffset`. Loop client-side until we've drained the
  // queue. Mirrors the pattern in app/admin/products/[id]/RunMatchingButton.tsx.

  async function handleMatch() {
    setMatching(true);
    setMatchError(null);
    setMatchProgress({ completed: 0, total: 0, auto: 0, review: 0, noMatch: 0 });
    setMatchUnmatched([]);
    setMatchDone(false);
    setShowMatchDebug(false);

    let offset = 0;
    let totalAuto = 0;
    let totalReview = 0;
    let totalNoMatch = 0;
    let grandTotal = 0;
    const unmatched: MatchRow[] = [];

    try {
      while (true) {
        const res = await fetch('/api/admin/match-cardhedger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId, offset }),
        });

        // res.text() + manual parse so the (rare) HTML timeout page doesn't
        // surface as "Unexpected token 'A', 'An error o'..." anymore.
        const text = await res.text();
        let json: { results?: MatchRow[]; error?: string; processed?: number; hasMore?: boolean; total?: number };
        try { json = JSON.parse(text); }
        catch {
          setMatchError(`Match failed at offset ${offset}: server returned non-JSON (${res.status}). ${text.slice(0, 120)}`);
          setMatching(false);
          return;
        }

        if (!res.ok || json.error) {
          setMatchError(asErrorMessage(json.error, `Match failed (${res.status})`));
          setMatching(false);
          return;
        }

        const batch = json.results ?? [];
        grandTotal = json.total ?? grandTotal;
        for (const r of batch) {
          if (r.status === 'auto') totalAuto++;
          else if (r.status === 'review') { totalReview++; unmatched.push(r); }
          else { totalNoMatch++; unmatched.push(r); }
        }
        offset += json.processed ?? batch.length;

        setMatchProgress({
          completed: offset,
          total: grandTotal,
          auto: totalAuto,
          review: totalReview,
          noMatch: totalNoMatch,
        });
        setMatchUnmatched([...unmatched]);

        if (!json.hasMore) break;
        await new Promise(r => setTimeout(r, 300));
      }
      setMatchDone(true);
    } catch (err) {
      setMatchError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setMatching(false);
    }
  }

  // ── Step 3: Odds upload ────────────────────────────────────────────────────

  async function handleOddsUpload() {
    const file = oddsFileRef.current?.files?.[0];
    if (!file) { setOddsError('Select an odds PDF first.'); return; }

    setOddsUploading(true);
    setOddsError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      // Parse odds
      const parseRes = await fetch('/api/admin/parse-odds', { method: 'POST', body: formData });
      const parseJson = await parseRes.json();
      if (!parseRes.ok || parseJson.error) {
        setOddsError(asErrorMessage(parseJson.error, 'Odds parse failed'));
        setOddsUploading(false);
        return;
      }

      // Apply odds to variants
      const applyRes = await fetch('/api/admin/apply-odds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, odds: parseJson.odds }),
      });
      const applyJson = await applyRes.json();
      if (!applyRes.ok || applyJson.error) {
        setOddsError(asErrorMessage(applyJson.error, 'Apply odds failed'));
      } else {
        setOddsResult(applyJson);
      }
    } catch (err) {
      setOddsError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setOddsUploading(false);
    }
  }

  function updateSection(i: number, patch: Partial<SectionConfig>) {
    setSections(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/admin/products" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Products
          </Link>
          <div className="text-right">
            <p className="text-sm font-semibold">Import Checklist</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Admin</p>
          </div>
        </div>
      </header>

      {/* Step indicator */}
      <div className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-4 py-3 flex gap-6 text-sm">
          {(['upload', 'review', 'result'] as Step[]).map((s, i) => (
            <span
              key={s}
              className={step === s ? 'font-semibold text-foreground' : 'text-muted-foreground'}
            >
              {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
          ))}
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* ── STEP 1: UPLOAD ─────────────────────────────────────────── */}
        {step === 'upload' && (
          <div className="bg-card border rounded overflow-hidden">
            <div className="h-1 bg-[var(--topps-red)]" />
            <div className="p-6 space-y-5">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                1 — Upload Checklist
              </h2>

              {/* Product selector */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Product</label>
                {products.length > 0 ? (
                  <select
                    value={productId}
                    onChange={e => setProductId(e.target.value)}
                    className="w-full rounded border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">— select product —</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={productId}
                    onChange={e => setProductId(e.target.value)}
                    placeholder="Paste product UUID"
                    className="w-full rounded border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                )}
              </div>

              {/* Upper Deck manufacturer-specific importer — renders only
                  when the selected product's manufacturer is UD-family. */}
              {(() => {
                const selected = products.find(p => p.id === productId);
                if (!selected || !UD_MANUFACTURERS.has(selected.manufacturer)) return null;
                return (
                  <div className="rounded border p-4 space-y-3" style={{ borderColor: 'rgba(6, 182, 212, 0.35)', backgroundColor: 'rgba(6, 182, 212, 0.06)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#67e8f9' }}>
                        Upper Deck importer · {selected.manufacturer}
                      </h3>
                      <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                        Skip Step 1 — applies checklist + odds in one pass
                      </span>
                    </div>
                    <UpperDeckImporter productId={productId} />
                  </div>
                );
              })()}

              {/* File input */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Checklist file(s)</label>
                <p className="text-xs text-muted-foreground">
                  Accepts Topps PDF, Panini/Donruss CSV, Bowman-style XLSX, or multiple CSVs (select all at once — Base, Prospects, Autographs, Inserts, Variations)
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.csv,.xlsx,.xls"
                  multiple
                  className="text-sm text-muted-foreground file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:cursor-pointer"
                />
              </div>

              {parseError && <p className="text-sm text-red-500">{parseError}</p>}

              <button
                onClick={handleParse}
                disabled={parsing}
                className="rounded bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {parsing ? 'Parsing…' : 'Parse →'}
              </button>

              {parsing && (
                <p className="text-sm text-muted-foreground animate-pulse">
                  Extracting sections — may take a few seconds for large PDFs…
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 2: REVIEW ─────────────────────────────────────────── */}
        {step === 'review' && (
          <>
            <div className="bg-card border rounded overflow-hidden">
              <div className="h-1 bg-[var(--topps-red)]" />
              <div className="p-6 space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                      2 — Review & Configure
                    </h2>
                    {productName && (
                      <p className="text-xs text-muted-foreground mt-1">Detected: {productName}</p>
                    )}
                  </div>
                  <button
                    onClick={() => { setStep('upload'); setSections([]); }}
                    className="text-xs text-muted-foreground underline shrink-0"
                  >
                    ← Back
                  </button>
                </div>

                <p className="text-sm text-muted-foreground">
                  {sections.length} section{sections.length !== 1 ? 's' : ''} found.
                  Set Hobby/BD sets per section, then import.
                </p>

                {/* Sections table */}
                <div className="rounded border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground w-8">✓</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Section</th>
                        <th className="px-3 py-2 text-center font-medium text-muted-foreground">Cards</th>
                        <th className="px-3 py-2 text-center font-medium text-muted-foreground">Flagged</th>
                        <th className="px-3 py-2 text-center font-medium text-muted-foreground">Hobby Sets</th>
                        <th className="px-3 py-2 text-center font-medium text-muted-foreground">BD Sets</th>
                        <th className="px-3 py-2 text-center font-medium text-muted-foreground w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {sections.map((s, i) => (
                        <>
                          <tr key={s.sectionName} className={s.include ? '' : 'opacity-40'}>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={s.include}
                                onChange={e => updateSection(i, { include: e.target.checked })}
                                className="cursor-pointer"
                              />
                            </td>
                            <td className="px-3 py-2 font-medium">{s.sectionName}</td>
                            <td className="px-3 py-2 text-center text-muted-foreground">{s.cardCount}</td>
                            <td className="px-3 py-2 text-center">
                              {s.flaggedCount > 0 ? (
                                <span className="text-yellow-600 font-medium">{s.flaggedCount}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="number"
                                min={0}
                                value={s.hobbySets}
                                onChange={e => updateSection(i, { hobbySets: Math.max(0, parseInt(e.target.value) || 0) })}
                                className="w-14 text-center rounded border bg-background px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="number"
                                min={0}
                                value={s.bdSets}
                                onChange={e => updateSection(i, { bdSets: Math.max(0, parseInt(e.target.value) || 0) })}
                                className="w-14 text-center rounded border bg-background px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => updateSection(i, { expanded: !s.expanded })}
                                className="text-xs text-muted-foreground hover:text-foreground"
                              >
                                {s.expanded ? '▲' : '▼'}
                              </button>
                            </td>
                          </tr>

                          {/* Expanded: cards + flagged */}
                          {s.expanded && (
                            <tr key={`${s.sectionName}-expanded`}>
                              <td colSpan={7} className="px-4 pb-3 pt-1 bg-muted/20">
                                {s.cards.length > 0 && (
                                  <div className="max-h-48 overflow-y-auto rounded border bg-background">
                                    <table className="w-full text-xs">
                                      <thead className="bg-muted/40 sticky top-0">
                                        <tr>
                                          <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">#</th>
                                          <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Player</th>
                                          <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Team</th>
                                          <th className="px-2 py-1.5 text-center font-medium text-muted-foreground">RC</th>
                                          <th className="px-2 py-1.5 text-center font-medium text-muted-foreground">SP</th>
                                          <th className="px-2 py-1.5 text-center font-medium text-muted-foreground">PR</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y">
                                        {s.cards.map((c, ci) => (
                                          <tr key={ci} className="hover:bg-muted/20">
                                            <td className="px-2 py-1 text-muted-foreground">{c.cardNumber ?? '—'}</td>
                                            <td className="px-2 py-1">{c.playerName}</td>
                                            <td className="px-2 py-1 text-muted-foreground">{c.team ?? '—'}</td>
                                            <td className="px-2 py-1 text-center">{c.isRookie ? '✓' : ''}</td>
                                            <td className="px-2 py-1 text-center">{c.isSP ? '✓' : ''}</td>
                                            <td className="px-2 py-1 text-center">{c.printRun ?? '—'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {s.flagged.length > 0 && (
                                  <div className="mt-2 space-y-0.5">
                                    <p className="text-xs font-medium text-yellow-600">
                                      {s.flagged.length} flagged line{s.flagged.length !== 1 ? 's' : ''} (couldn't fully parse):
                                    </p>
                                    {s.flagged.map((fl, fi) => (
                                      <p key={fi} className="text-xs font-mono text-yellow-700 bg-yellow-50 dark:bg-yellow-950/30 rounded px-2 py-0.5 truncate">
                                        {fl}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>

                {importError && <p className="text-sm text-red-500">{importError}</p>}

                {importing && importProgress && importProgress.totalBatches > 1 && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>
                      Batch {importProgress.completedBatches}/{importProgress.totalBatches}
                      {' · '}
                      {importProgress.cardsImported.toLocaleString()}/{importProgress.totalCards.toLocaleString()} cards
                    </div>
                    <div className="h-1 w-64 bg-muted rounded overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{
                          width: `${(importProgress.completedBatches / importProgress.totalBatches) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <button
                  onClick={handleImport}
                  disabled={importing || sections.filter(s => s.include).length === 0}
                  className="rounded bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {importing ? 'Importing…' : `Import ${sections.filter(s => s.include).reduce((n, s) => n + s.cardCount, 0)} cards →`}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── STEP 3: RESULT ─────────────────────────────────────────── */}
        {step === 'result' && importResult && (
          <>
            {/* Summary */}
            <div className="bg-card border rounded overflow-hidden">
              <div className="h-1 bg-green-500" />
              <div className="p-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                    3 — Import Complete
                  </h2>
                  <a
                    href={`/admin/products/${productId}`}
                    className="shrink-0 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all hover:scale-[1.02]"
                    style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}
                  >
                    Go to Product Dashboard →
                  </a>
                </div>
                <div className="flex gap-8">
                  <div className="text-center">
                    <p className="text-2xl font-bold">{importResult.playersCreated}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Players created</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">{importResult.playerProductsCreated}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Player-products</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">{importResult.variantsCreated}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Variants</p>
                  </div>
                </div>
              </div>
            </div>

            {/* CardHedger matching */}
            <div className="bg-card border rounded overflow-hidden">
              <div className="h-1 bg-[var(--topps-red)]" />
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold">Match CardHedger IDs</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Auto-links variants to CardHedger card IDs for live pricing.
                      Confidence ≥ 0.7 auto-writes; 0.5–0.69 needs review.
                    </p>
                  </div>
                  <button
                    onClick={handleMatch}
                    disabled={matching}
                    className="rounded bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0"
                  >
                    {matching ? 'Matching…' : 'Run Match'}
                  </button>
                </div>

                {matchError && <p className="text-sm text-red-500">{matchError}</p>}

                {matchProgress && (matching || matchDone) && (
                  <div className="space-y-3">
                    {/* Progress bar — fixed height; doesn't grow with batches */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs tabular-nums">
                        <span className="font-medium">
                          {matchDone ? 'Matching complete' : 'Matching…'}
                        </span>
                        <span className="text-muted-foreground">
                          {matchProgress.completed.toLocaleString()} / {matchProgress.total ? matchProgress.total.toLocaleString() : '…'}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{
                            width: matchProgress.total > 0
                              ? `${Math.min(100, (matchProgress.completed / matchProgress.total) * 100)}%`
                              : '0%',
                          }}
                        />
                      </div>
                    </div>

                    {/* Live counts — always visible during the run */}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded border bg-muted/20 px-3 py-2">
                        <div className="text-xl font-bold tabular-nums text-green-600">{matchProgress.auto.toLocaleString()}</div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">Auto</div>
                      </div>
                      <div className="rounded border bg-muted/20 px-3 py-2">
                        <div className="text-xl font-bold tabular-nums text-yellow-600">{matchProgress.review.toLocaleString()}</div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">Review</div>
                      </div>
                      <div className="rounded border bg-muted/20 px-3 py-2">
                        <div className="text-xl font-bold tabular-nums text-red-500">{matchProgress.noMatch.toLocaleString()}</div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">No match</div>
                      </div>
                    </div>

                    {/* Post-run only: collapsible unmatched panel */}
                    {matchDone && matchUnmatched.length > 0 && (
                      <div className="space-y-2 pt-2 border-t">
                        <button
                          type="button"
                          onClick={() => setShowMatchDebug(v => !v)}
                          className="text-xs underline text-muted-foreground hover:text-foreground"
                        >
                          {showMatchDebug ? 'Hide' : 'View'} {matchUnmatched.length} unmatched / review row{matchUnmatched.length !== 1 ? 's' : ''}
                        </button>
                        {showMatchDebug && (
                          <div className="rounded border overflow-auto max-h-96">
                            <table className="w-full text-xs">
                              <thead className="bg-muted/50 sticky top-0">
                                <tr>
                                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Player</th>
                                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Variant</th>
                                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">#</th>
                                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">Conf.</th>
                                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {matchUnmatched.map(r => (
                                  <tr key={r.variantId} className="hover:bg-muted/20">
                                    <td className="px-3 py-1.5">{r.playerName}</td>
                                    <td className="px-3 py-1.5 text-muted-foreground">{r.variantName}</td>
                                    <td className="px-3 py-1.5 text-muted-foreground">{r.cardNumber ?? '—'}</td>
                                    <td className="px-3 py-1.5 text-center tabular-nums">{(r.confidence * 100).toFixed(0)}%</td>
                                    <td className={`px-3 py-1.5 text-center text-[10px] font-medium uppercase ${confidenceColor(r.status)}`}>
                                      {r.status}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Odds upload */}
            <div className="bg-card border rounded overflow-hidden">
              <div className="h-1 bg-muted" />
              <div className="p-6 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">Upload Odds Sheet <span className="text-xs font-normal text-muted-foreground">(optional)</span></h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Topps odds PDF — attaches hobby/breaker pull rates to matching variants.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    ref={oddsFileRef}
                    type="file"
                    accept=".pdf"
                    disabled={oddsUploading}
                    className="text-sm text-muted-foreground file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:cursor-pointer"
                  />
                  <button
                    onClick={handleOddsUpload}
                    disabled={oddsUploading}
                    className="rounded bg-secondary px-4 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
                  >
                    {oddsUploading ? 'Applying…' : 'Upload & Apply'}
                  </button>
                </div>

                {oddsError && <p className="text-sm text-red-500">{oddsError}</p>}
                {oddsResult && (
                  <div className="space-y-3">
                    <p className="text-sm text-green-600 font-medium">
                      Odds applied to {oddsResult.updatedCount} variant{oddsResult.updatedCount !== 1 ? 's' : ''}.
                    </p>
                    {oddsResult.matched.length > 0 && (
                      <div className="rounded border overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Odds Row</th>
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Matched Variant</th>
                              <th className="px-3 py-2 text-center font-medium text-muted-foreground">Hobby Odds</th>
                              <th className="px-3 py-2 text-center font-medium text-muted-foreground">Breaker Odds</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {oddsResult.matched.map((m, i) => (
                              <tr key={i} className="hover:bg-muted/20">
                                <td className="px-3 py-1.5 text-muted-foreground">{m.subsetName}</td>
                                <td className="px-3 py-1.5 text-green-600">{m.variantName}</td>
                                <td className="px-3 py-1.5 text-center">{m.hobbyOdds != null ? `1:${m.hobbyOdds}` : '—'}</td>
                                <td className="px-3 py-1.5 text-center">{m.breakerOdds != null ? `1:${m.breakerOdds}` : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {oddsResult.unmatched.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-yellow-600 mb-1">
                          {oddsResult.unmatched.length} odds row{oddsResult.unmatched.length !== 1 ? 's' : ''} had no matching variant:
                        </p>
                        {oddsResult.unmatched.map((u, i) => (
                          <p key={i} className="text-xs font-mono text-yellow-700 bg-yellow-50 dark:bg-yellow-950/30 rounded px-2 py-0.5 truncate">
                            {u}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Start over */}
            <div className="text-center">
              <button
                onClick={() => {
                  setStep('upload');
                  setSections([]);
                  setImportResult(null);
                  setMatchProgress(null);
                  setMatchUnmatched([]);
                  setMatchDone(false);
                  setMatchError(null);
                  setOddsResult(null);
                  setProductId('');
                  if (fileRef.current) fileRef.current.value = '';
                  if (oddsFileRef.current) oddsFileRef.current.value = '';
                }}
                className="text-sm text-muted-foreground underline"
              >
                Import another checklist
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function ImportChecklistPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-sm text-muted-foreground">Loading…</p></div>}>
      <ImportChecklistInner />
    </Suspense>
  );
}
