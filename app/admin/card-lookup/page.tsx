'use client';

import { useRef, useState } from 'react';
import { ScanLine, Search, Upload, RotateCcw } from 'lucide-react';
import { formatCurrency } from '@/lib/engine';

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

interface CertSale {
  closing_date: string;
  Grade: string;
  card_id: string;
  price: string;
}

interface CertResult {
  source: 'cert';
  certInfo: { grader: string; cert: string; grade: string; description: string };
  card: { card_id: string; description: string; player: string; set: string; number: string; variant: string; image: string } | null;
  prices: CertSale[];
  lastSale: CertSale | null;
  avgPrice: number | null;
}

interface SearchResult {
  source: 'search';
  card: { card_id: string; player_name: string; set_name: string; year: string; number: string; variant: string; rookie: boolean };
  allPrices: Array<{ grade: string; price: string }>;
  comps: Array<{ sale_price: number; sale_date: string; grade: string; platform: string }>;
  matchedGrade: string;
  matchedPrice: { grade: string; price: number } | null;
  certFallback?: boolean;
}

type LookupResult = CertResult | SearchResult;

export default function CardLookupPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string>('image/jpeg');

  const [isParsing, setIsParsing] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedCard | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

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
      const res = await fetch('/api/admin/card-lookup', {
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

  async function lookup() {
    if (!extracted) return;
    setIsFetching(true);
    setLookupError(null);
    setResult(null);
    try {
      // Prefer cert lookup — direct, exact identity
      if (extracted.certNumber.trim()) {
        const res = await fetch('/api/admin/card-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cert', cert: extracted.certNumber.trim() }),
        });
        const certData = await res.json();
        if (certData.error) throw new Error(certData.error);

        // If cert returned no price history, fall through to name-based search
        if (certData.prices && certData.prices.length > 0) {
          setResult(certData);
        } else {
          // Name-based fallback — cert confirms identity but has no sales
          const res2 = await fetch('/api/admin/card-lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'price', ...extracted }),
          });
          const searchData = await res2.json();
          if (searchData.error) throw new Error(`Cert found but no price data — name search also failed: ${searchData.error}`);
          setResult({ ...searchData, certFallback: true });
        }
      } else {
        // No cert — name-based search only
        const res = await fetch('/api/admin/card-lookup', {
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

  function reset() {
    setImagePreview(null);
    setImageBase64(null);
    setExtracted(null);
    setResult(null);
    setParseError(null);
    setLookupError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Compute fair value depending on result source
  const fairValue: number | null = (() => {
    if (!result) return null;
    if (result.source === 'cert') return result.avgPrice;
    return result.matchedPrice?.price ?? null;
  })();

  const maxBid = fairValue != null ? fairValue * (1 - parseFloat(margin || '0') / 100) : null;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ScanLine className="size-5 text-primary" />
            <h1 className="text-2xl font-black">Card Lookup</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Screenshot a listing → AI reads cert number → instant price history from CardHedger
          </p>
        </div>
        {imagePreview && (
          <button onClick={reset} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <RotateCcw className="size-3.5" />
            Start over
          </button>
        )}
      </div>

      {/* Upload zone */}
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
                  onClick={lookup}
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

          {/* Right — results */}
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
                  <p className="text-sm text-muted-foreground">Pulling data from CardHedger…</p>
                </div>
              </div>
            )}

            {result && !isFetching && (
              <div className="space-y-4">
                {/* Cert fallback notice */}
                {result.source === 'search' && result.certFallback && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
                    Cert found but no sale history — showing comps by card name instead
                  </div>
                )}
                {/* Card identity */}
                <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                  <div className="flex items-start gap-3">
                    {result.source === 'cert' && result.card?.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={result.card.image} alt="Card" className="w-14 h-20 object-contain rounded flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          {result.source === 'cert' ? 'Cert Match' : 'CardHedger Match'}
                        </p>
                        {result.source === 'cert' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}>
                            {result.certInfo.grade}
                          </span>
                        )}
                      </div>
                      <p className="font-bold text-foreground">
                        {result.source === 'cert' ? (result.card?.player ?? result.certInfo.description) : result.card.player_name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {result.source === 'cert'
                          ? (result.card?.description ?? `${result.certInfo.grader} ${result.certInfo.grade}`)
                          : `${result.card.year} ${result.card.set_name} #${result.card.number}${result.card.variant ? ` · ${result.card.variant}` : ''}`}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Price summary */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                      {result.source === 'cert' ? 'Avg Sale Price' : `Fair Value (${result.matchedPrice?.grade ?? ''})`}
                    </p>
                    <p className="text-2xl font-black font-mono text-foreground">
                      {fairValue != null ? formatCurrency(fairValue) : '—'}
                    </p>
                    {result.source === 'cert' && (
                      <p className="text-xs text-muted-foreground mt-0.5">{result.prices.length} sales</p>
                    )}
                  </div>
                  <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Last Sale</p>
                    <p className="text-2xl font-black font-mono text-foreground">
                      {result.source === 'cert' && result.lastSale
                        ? formatCurrency(parseFloat(result.lastSale.price))
                        : result.source === 'search' && result.comps[0]
                          ? formatCurrency(result.comps[0].sale_price)
                          : '—'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {result.source === 'cert' && result.lastSale
                        ? new Date(result.lastSale.closing_date).toLocaleDateString()
                        : result.source === 'search' && result.comps[0]
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

                {/* Price history (cert) or grade prices (search) */}
                {result.source === 'cert' && result.prices.length > 0 && (
                  <div className="rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                    <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Sale History — {result.certInfo.grade}
                      </p>
                    </div>
                    <div className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                      {result.prices.map((p, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                          <span className="font-mono font-semibold text-foreground">{formatCurrency(parseFloat(p.price))}</span>
                          <span className="text-xs text-muted-foreground">{new Date(p.closing_date).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {result.source === 'search' && result.comps.length > 0 && (
                  <div className="rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                    <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Recent Comps — {result.matchedGrade} (90 days)
                      </p>
                    </div>
                    <div className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                      {result.comps.map((c, i) => (
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
        </div>
      )}
    </div>
  );
}

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
