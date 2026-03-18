'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ParsedChecklist, ParsedSection } from '@/lib/checklist-parser';

// ─── Types ───────────────────────────────────────────────────────────────────

type Product = { id: string; name: string; slug: string };

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

// ─── Component ───────────────────────────────────────────────────────────────

export default function ImportChecklistPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const oddsFileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const [sections, setSections] = useState<SectionConfig[]>([]);
  const [productName, setProductName] = useState('');

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const [matching, setMatching] = useState(false);
  const [matchResults, setMatchResults] = useState<MatchRow[] | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);

  const [oddsUploading, setOddsUploading] = useState(false);
  const [oddsError, setOddsError] = useState<string | null>(null);
  const [oddsApplied, setOddsApplied] = useState<number | null>(null);

  // Fetch products on mount
  useEffect(() => {
    fetch('/api/admin/products')
      .then(r => r.json())
      .then(d => setProducts(d.products ?? []))
      .catch(() => {/* ignore — user can still type a product ID */});
  }, []);

  // ── Step 1: Parse ──────────────────────────────────────────────────────────

  async function handleParse() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setParseError('Select a file first.'); return; }
    if (!productId) { setParseError('Select a product first.'); return; }

    setParseError(null);
    setParsing(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/admin/parse-checklist', { method: 'POST', body: formData });
      const json = await res.json();

      if (!res.ok || json.error) {
        setParseError(json.error ?? 'Parse failed');
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

  async function handleImport() {
    const included = sections.filter(s => s.include);
    if (!included.length) { setImportError('Include at least one section.'); return; }

    setImporting(true);
    setImportError(null);

    try {
      const body = {
        productId,
        sections: included.map(s => ({
          sectionName: s.sectionName,
          hobbySets: s.hobbySets,
          bdSets: s.bdSets,
          cards: s.cards,
        })),
      };

      const res = await fetch('/api/admin/import-checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (!res.ok || json.error) {
        setImportError(json.error ?? 'Import failed');
        setImporting(false);
        return;
      }

      setImportResult(json);
      setStep('result');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setImporting(false);
    }
  }

  // ── Step 3: Match CardHedger ───────────────────────────────────────────────

  async function handleMatch() {
    setMatching(true);
    setMatchError(null);
    setMatchResults(null);

    try {
      const res = await fetch('/api/admin/match-cardhedger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setMatchError(json.error ?? 'Match failed');
      } else {
        setMatchResults(json.results);
      }
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
        setOddsError(parseJson.error ?? 'Odds parse failed');
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
        setOddsError(applyJson.error ?? 'Apply odds failed');
      } else {
        setOddsApplied(applyJson.updatedCount ?? 0);
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

              {/* File input */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Checklist file</label>
                <p className="text-xs text-muted-foreground">
                  Accepts Topps PDF (numbered or code-based) or Panini/Donruss CSV
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.csv"
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
                <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  3 — Import Complete
                </h2>
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

                {matchResults && (
                  <div className="rounded border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Player</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Variant</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">#</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Card ID</th>
                          <th className="px-3 py-2 text-center font-medium text-muted-foreground">Conf.</th>
                          <th className="px-3 py-2 text-center font-medium text-muted-foreground">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {matchResults.map(r => (
                          <tr key={r.variantId} className="hover:bg-muted/20">
                            <td className="px-3 py-1.5">{r.playerName}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{r.variantName}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{r.cardNumber ?? '—'}</td>
                            <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{r.cardId ?? '—'}</td>
                            <td className="px-3 py-1.5 text-center">{(r.confidence * 100).toFixed(0)}%</td>
                            <td className={`px-3 py-1.5 text-center text-xs font-medium ${confidenceColor(r.status)}`}>
                              {r.status}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="px-3 py-2 bg-muted/30 text-xs text-muted-foreground flex gap-4">
                      <span className="text-green-600">{matchResults.filter(r => r.status === 'auto').length} auto-matched</span>
                      <span className="text-yellow-600">{matchResults.filter(r => r.status === 'review').length} needs review</span>
                      <span className="text-red-500">{matchResults.filter(r => r.status === 'no-match').length} no match</span>
                    </div>
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
                {oddsApplied !== null && (
                  <p className="text-sm text-green-600">
                    Odds applied to {oddsApplied} variant{oddsApplied !== 1 ? 's' : ''}.
                  </p>
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
                  setMatchResults(null);
                  setOddsApplied(null);
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
