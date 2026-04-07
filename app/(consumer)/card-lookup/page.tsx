'use client';

import { useRef, useState } from 'react';
import { ScanLine, Search, Upload, RotateCcw, ShieldCheck, Hash } from 'lucide-react';
import { formatCurrency } from '@/lib/engine';

type InputMethod = 'image' | 'cert';
type Grader = 'PSA' | 'BGS' | 'SGC';

interface ExtractedCard {
  playerName: string;
  setName: string;
  year: string;
  cardNumber: string;
  variant: string;
  gradingCompany: string;
  grade: string;
  certNumber: string;
}

interface PSACert {
  CertNumber: string;
  Year: string;
  Brand: string;
  Category: string;
  CardNumber: string;
  Subject: string;
  Variety: string;
  CardGrade: string;
  GradeDescription: string;
  LabelType: string;
  TotalPopulation: number;
  TotalPopulationWithQualifier: number;
  PopulationHigher: number;
  ItemStatus: string;
}

interface CertResult {
  source: 'cert';
  psaVerified: boolean;
  psaCert: PSACert | null;
  certInfo: { grader: string; cert: string; grade: string; description: string };
  card: { card_id: string; description: string; player: string; set: string; number: string; variant: string; image: string } | null;
  allPrices: Array<{ grade: string; price: string }>;
  comps: Array<{ sale_price: number; sale_date: string; grade: string; platform: string }> | null;
  matchedPrice: { grade: string; price: number } | null;
  matchedGrade: string;
}

interface SearchResult {
  source: 'search';
  card: { card_id: string; player_name: string; set_name: string; year: string; number: string; variant: string; rookie: boolean; image?: string };
  allPrices: Array<{ grade: string; price: string }>;
  comps: Array<{ sale_price: number; sale_date: string; grade: string; platform: string }> | null;
  matchedGrade: string;
  matchedPrice: { grade: string; price: number } | null;
  certFallback?: boolean;
}

type LookupResult = CertResult | SearchResult;

export default function CardLookupPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Input method toggle
  const [inputMethod, setInputMethod] = useState<InputMethod>('image');

  // Image path state
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string>('image/jpeg');
  const [isParsing, setIsParsing] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedCard | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Direct cert path state
  const [directCert, setDirectCert] = useState('');
  const [directGrader, setDirectGrader] = useState<Grader>('PSA');

  // Shared result state
  const [isFetching, setIsFetching] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [margin, setMargin] = useState('20');

  function handleFile(file: File) {
    setExtracted(null);
    setResult(null);
    setParseError(null);
    setLookupError(null);
    setMediaType(file.type || 'image/jpeg');
    setImagePreview(URL.createObjectURL(file));
    const reader = new FileReader();
    reader.onload = e => {
      const b64 = (e.target?.result as string).split(',')[1];
      setImageBase64(b64);
    };
    reader.readAsDataURL(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  }

  async function parseScreenshot() {
    if (!imageBase64) return;
    setIsParsing(true);
    setParseError(null);
    try {
      const res = await fetch('/api/card-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'parse', imageBase64, mediaType }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setExtracted(data);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setIsParsing(false);
    }
  }

  async function lookupFromExtracted() {
    if (!extracted) return;
    setIsFetching(true);
    setLookupError(null);
    setResult(null);
    try {
      if (extracted.certNumber.trim()) {
        await runCertLookup(extracted.certNumber.trim(), extracted.gradingCompany || 'PSA');
      } else {
        const res = await fetch('/api/card-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'price', ...extracted }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setResult(data);
      }
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setIsFetching(false);
    }
  }

  async function lookupDirectCert() {
    if (!directCert.trim()) return;
    setIsFetching(true);
    setLookupError(null);
    setResult(null);
    try {
      await runCertLookup(directCert.trim(), directGrader);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setIsFetching(false);
    }
  }

  async function runCertLookup(cert: string, grader: string) {
    const res = await fetch('/api/card-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cert', cert, grader }),
    });
    const certData = await res.json();
    if (certData.error) throw new Error(certData.error);
    setResult(certData);
  }

  function reset() {
    setImagePreview(null);
    setImageBase64(null);
    setExtracted(null);
    setResult(null);
    setParseError(null);
    setLookupError(null);
    setDirectCert('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function switchMethod(method: InputMethod) {
    setInputMethod(method);
    reset();
  }

  const fairValue: number | null = (() => {
    if (!result) return null;
    return result.matchedPrice?.price ?? null;
  })();

  const maxBid = fairValue != null ? fairValue * (1 - parseFloat(margin || '0') / 100) : null;

  const showResults = result !== null || isFetching || lookupError !== null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Hero Header */}
      <div
        className="relative overflow-hidden rounded-2xl p-8"
        style={{ background: 'var(--gradient-hero)', border: '1px solid var(--terminal-border)' }}
      >
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, var(--accent-blue) 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }}
        />
        <div
          className="absolute top-0 right-0 w-96 h-96 blur-3xl opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--accent-blue) 0%, transparent 70%)' }}
        />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}
            >
              <ScanLine className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Slab Analysis
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Upload a cert image or enter a cert number — instant market value and recent comps
              </p>
            </div>
          </div>
          {(imagePreview || result || directCert) && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 text-sm font-medium transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              <RotateCcw className="size-3.5" />
              Start over
            </button>
          )}
        </div>
      </div>

      {/* Input method tabs */}
      <div
        className="flex rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
      >
        {(['image', 'cert'] as InputMethod[]).map(method => (
          <button
            key={method}
            onClick={() => switchMethod(method)}
            className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-all"
            style={{
              backgroundColor: inputMethod === method ? 'var(--accent-blue)' : 'transparent',
              color: inputMethod === method ? 'white' : 'var(--text-secondary)',
            }}
          >
            {method === 'image'
              ? <><Upload className="size-4" /> Upload Image</>
              : <><Hash className="size-4" /> Enter Cert #</>}
          </button>
        ))}
      </div>

      {/* Direct cert input */}
      {inputMethod === 'cert' && (
        <div
          className="rounded-xl p-6"
          style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <div className="flex gap-3 items-end">
            <div className="flex-shrink-0">
              <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                Grader
              </label>
              <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--terminal-border)' }}>
                {(['PSA', 'BGS', 'SGC'] as Grader[]).map(g => (
                  <button
                    key={g}
                    onClick={() => setDirectGrader(g)}
                    className="px-4 py-2 text-sm font-bold transition-all"
                    style={{
                      backgroundColor: directGrader === g ? 'var(--accent-blue)' : 'transparent',
                      color: directGrader === g ? 'white' : 'var(--text-secondary)',
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                Cert Number
              </label>
              <input
                type="text"
                value={directCert}
                onChange={e => setDirectCert(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') lookupDirectCert(); }}
                placeholder={directGrader === 'PSA' ? 'e.g. 12345678' : 'Cert number'}
                className="w-full rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
              />
            </div>
            <button
              onClick={lookupDirectCert}
              disabled={isFetching || !directCert.trim()}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--gradient-blue)', flexShrink: 0 }}
            >
              {isFetching
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Looking up…</>
                : <><Search className="size-4" /> Look Up</>}
            </button>
          </div>
        </div>
      )}

      {/* Image upload path */}
      {inputMethod === 'image' && (
        <>
          {!imagePreview ? (
            <div
              className="border-2 border-dashed rounded-xl p-16 text-center cursor-pointer hover:border-primary transition-colors"
              style={{ borderColor: 'var(--border)' }}
              onDrop={onDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-10 mx-auto mb-4 text-muted-foreground opacity-40" />
              <p className="font-semibold text-foreground mb-1">Drop a screenshot here</p>
              <p className="text-sm text-muted-foreground">or click to browse — JPEG, PNG, WebP</p>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left — image + extracted fields */}
              <div className="space-y-4">
                <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="Listing screenshot" className="w-full object-contain max-h-64" />
                </div>

                {!extracted ? (
                  <>
                    <button
                      onClick={parseScreenshot}
                      disabled={isParsing}
                      className="w-full py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50"
                      style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                      {isParsing
                        ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Reading listing…</>
                        : <><ScanLine className="size-4" /> Parse with AI</>}
                    </button>
                    {parseError && <p className="text-sm text-destructive">{parseError}</p>}
                  </>
                ) : (
                  <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Extracted Details</p>
                      {extracted.certNumber && (
                        <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}>
                          {extracted.gradingCompany} {extracted.certNumber}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Player" value={extracted.playerName} onChange={v => setExtracted(e => ({ ...e!, playerName: v }))} />
                      <Field label="Year" value={extracted.year} onChange={v => setExtracted(e => ({ ...e!, year: v }))} />
                      <Field label="Set Name" value={extracted.setName} onChange={v => setExtracted(e => ({ ...e!, setName: v }))} className="col-span-2" />
                      <Field label="Card #" value={extracted.cardNumber} onChange={v => setExtracted(e => ({ ...e!, cardNumber: v }))} />
                      <Field label="Variant" value={extracted.variant} onChange={v => setExtracted(e => ({ ...e!, variant: v }))} />
                      <Field label="Grading Co." value={extracted.gradingCompany} onChange={v => setExtracted(e => ({ ...e!, gradingCompany: v }))} />
                      <Field label="Grade" value={extracted.grade} onChange={v => setExtracted(e => ({ ...e!, grade: v }))} />
                      <Field label="Cert #" value={extracted.certNumber} onChange={v => setExtracted(e => ({ ...e!, certNumber: v }))} className="col-span-2" />
                    </div>

                    {!extracted.certNumber && (
                      <p className="text-xs text-amber-500">No cert number found — will fall back to name search</p>
                    )}

                    <button
                      onClick={lookupFromExtracted}
                      disabled={isFetching || !extracted.playerName}
                      className="w-full py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50 mt-1"
                      style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                      {isFetching
                        ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Looking up…</>
                        : <><Search className="size-4" /> {extracted.certNumber ? 'Look Up by Cert' : 'Search by Name'}</>}
                    </button>
                  </div>
                )}
              </div>

              {/* Right — results (image path) */}
              <ResultsPanel
                result={result}
                isFetching={isFetching}
                lookupError={lookupError}
                fairValue={fairValue}
                maxBid={maxBid}
                margin={margin}
                setMargin={setMargin}
                extracted={extracted}
              />
            </div>
          )}
        </>
      )}

      {/* Results for direct cert path */}
      {inputMethod === 'cert' && showResults && (
        <ResultsPanel
          result={result}
          isFetching={isFetching}
          lookupError={lookupError}
          fairValue={fairValue}
          maxBid={maxBid}
          margin={margin}
          setMargin={setMargin}
          extracted={null}
        />
      )}
    </div>
  );
}

// ── Shared results panel ────────────────────────────────────────────────────

function ResultsPanel({
  result,
  isFetching,
  lookupError,
  fairValue,
  maxBid,
  margin,
  setMargin,
  extracted,
}: {
  result: LookupResult | null;
  isFetching: boolean;
  lookupError: string | null;
  fairValue: number | null;
  maxBid: number | null;
  margin: string;
  setMargin: (v: string) => void;
  extracted: { certNumber?: string } | null;
}) {
  return (
    <div>
      {lookupError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive mb-4">
          {lookupError}
        </div>
      )}

      {isFetching && (
        <div className="rounded-lg border p-12 flex items-center justify-center" style={{ borderColor: 'var(--border)' }}>
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Pulling data…</p>
          </div>
        </div>
      )}

      {result && !isFetching && (
        <div className="space-y-4">
          {/* Cert fallback notice */}
          {result.source === 'search' && result.certFallback && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
              PSA cert confirmed — showing market comps by card (no cert-specific sale history)
            </div>
          )}

          {/* PSA Insights panel */}
          {result.source === 'cert' && result.psaVerified && result.psaCert && (
            <div
              className="rounded-lg overflow-hidden"
              style={{ border: '1px solid rgba(34,197,94,0.3)', backgroundColor: 'rgba(34,197,94,0.05)' }}
            >
              {/* Header */}
              <div
                className="px-4 py-2.5 flex items-center gap-2"
                style={{ backgroundColor: 'rgba(34,197,94,0.12)', borderBottom: '1px solid rgba(34,197,94,0.2)' }}
              >
                <ShieldCheck className="size-4" style={{ color: 'rgb(34,197,94)' }} />
                <span className="text-sm font-bold" style={{ color: 'rgb(34,197,94)' }}>PSA Verified</span>
                <span className="text-xs font-mono font-bold ml-auto" style={{ color: 'var(--text-primary)' }}>
                  {result.psaCert.GradeDescription}
                </span>
              </div>
              {/* Data grid */}
              <div className="grid grid-cols-2 gap-px" style={{ backgroundColor: 'rgba(34,197,94,0.1)' }}>
                <PSAField label="Cert #" value={result.certInfo.cert} mono />
                <PSAField label="Label Type" value={result.psaCert.LabelType || '—'} />
                <PSAField label="Pop at This Grade" value={result.psaCert.TotalPopulation > 0 ? String(result.psaCert.TotalPopulation) : '—'} mono />
                <PSAField label="Pop Higher" value={result.psaCert.PopulationHigher > 0 ? String(result.psaCert.PopulationHigher) : '—'} mono highlight="amber" />
                {result.psaCert.TotalPopulationWithQualifier > 0 && result.psaCert.TotalPopulationWithQualifier !== result.psaCert.TotalPopulation && (
                  <PSAField label="With Qualifier" value={String(result.psaCert.TotalPopulationWithQualifier)} mono className="col-span-2" />
                )}
              </div>
            </div>
          )}

          {/* Card identity */}
          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
            <div className="flex items-start gap-3">
              {((result.source === 'cert' && result.card?.image) || (result.source === 'search' && result.card.image)) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.source === 'cert' ? result.card!.image! : result.card.image!}
                  alt="Card"
                  className="w-14 h-20 object-contain rounded flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-0.5">
                  {result.source === 'cert' && result.psaVerified ? 'PSA Cert Match' : result.source === 'cert' ? 'Cert Match' : 'CardHedger Match'}
                </p>
                <p className="font-bold text-foreground">
                  {result.source === 'cert'
                    ? (result.psaCert?.Subject ?? result.card?.player ?? result.certInfo.description)
                    : result.card.player_name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {result.source === 'cert'
                    ? (result.psaCert
                        ? `${result.psaCert.Year} ${result.psaCert.Brand}${result.psaCert.CardNumber ? ` #${result.psaCert.CardNumber}` : ''}${result.psaCert.Variety ? ` · ${result.psaCert.Variety}` : ''}`
                        : (result.card?.description ?? `${result.certInfo.grader} ${result.certInfo.grade}`))
                    : `${result.card.year} ${result.card.set_name} #${result.card.number}${result.card.variant ? ` · ${result.card.variant}` : ''}`}
                </p>
              </div>
            </div>
          </div>

          {/* Price summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                Market Value ({result.matchedPrice?.grade ?? result.matchedGrade ?? ''})
              </p>
              <p className="text-2xl font-black font-mono text-foreground">
                {fairValue != null ? formatCurrency(fairValue) : '—'}
              </p>
            </div>
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Last Comp</p>
              <p className="text-2xl font-black font-mono text-foreground">
                {result.comps?.[0] ? formatCurrency(result.comps[0].sale_price) : '—'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {result.comps?.[0]
                  ? `${new Date(result.comps[0].sale_date).toLocaleDateString()} · ${result.comps[0].platform}`
                  : ''}
              </p>
            </div>
          </div>

          {/* Max bid calculator */}
          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Max Bid Calculator</p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <label className="text-sm text-muted-foreground whitespace-nowrap">My margin</label>
                <input
                  type="number"
                  value={margin}
                  onChange={e => setMargin(e.target.value)}
                  min="0" max="100"
                  className="w-16 text-sm font-mono rounded border px-2 py-1 text-center focus:outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--input)', color: 'var(--foreground)' }}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Max bid</p>
                <p className="text-xl font-black font-mono" style={{ color: maxBid != null ? 'var(--primary)' : 'var(--muted-foreground)' }}>
                  {maxBid != null ? formatCurrency(maxBid) : '—'}
                </p>
              </div>
            </div>
          </div>

          {/* All grade prices — shown for both cert and search results */}
          {result.allPrices.length > 0 && (
            <div className="rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Grade Prices</p>
              </div>
              <div className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                {result.allPrices.map((p, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-muted-foreground">{p.grade}</span>
                    <span
                      className="font-mono font-semibold"
                      style={{ color: result.matchedPrice && p.grade === result.matchedPrice.grade ? 'var(--primary)' : 'var(--foreground)' }}
                    >
                      {formatCurrency(parseFloat(String(p.price)))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent comps — shown for both cert and search */}
          {(result.comps?.length ?? 0) > 0 && (
            <div className="rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Recent Comps — {result.matchedGrade} (90 days)
                </p>
              </div>
              <div className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                {result.comps!.map((c, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                    <div>
                      <span className="font-mono font-semibold text-foreground">{formatCurrency(c.sale_price)}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{c.grade}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(c.sale_date).toLocaleDateString()} · {c.platform}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!result && !isFetching && !lookupError && extracted && (
        <div className="rounded-lg border p-12 flex items-center justify-center" style={{ borderColor: 'var(--border)' }}>
          <div className="text-center">
            <Search className="size-8 mx-auto mb-3 text-muted-foreground opacity-30" />
            <p className="text-sm text-muted-foreground">
              {extracted.certNumber ? 'Ready to look up by cert number' : 'Confirm the details, then search by name'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PSA insights field ────────────────────────────────────────────────────────

function PSAField({ label, value, mono, highlight, className = '' }: {
  label: string; value: string; mono?: boolean; highlight?: 'amber'; className?: string;
}) {
  return (
    <div className={`px-4 py-2.5 ${className}`} style={{ backgroundColor: 'rgba(0,0,0,0.2)' }}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: 'rgba(34,197,94,0.6)' }}>{label}</p>
      <p
        className={`text-sm font-semibold ${mono ? 'font-mono' : ''}`}
        style={{ color: highlight === 'amber' ? 'rgb(251,191,36)' : 'var(--text-primary)' }}
      >
        {value}
      </p>
    </div>
  );
}

// ── Field editor ──────────────────────────────────────────────────────────────

function Field({ label, value, onChange, className = '' }: {
  label: string; value: string; onChange: (v: string) => void; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full text-sm rounded border px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--input)', color: 'var(--foreground)' }}
      />
    </div>
  );
}
