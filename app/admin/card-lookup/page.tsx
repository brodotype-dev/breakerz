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

interface PriceEntry {
  grade: string;
  price: string;
}

interface Comp {
  sale_price: number;
  sale_date: string;
  grade: string;
  platform: string;
}

interface PriceResult {
  card: {
    card_id: string;
    player_name: string;
    set_name: string;
    year: string;
    number: string;
    variant: string;
    rookie: boolean;
  };
  prices: PriceEntry[];
  comps: Comp[];
  matchedGrade: string;
  matchedPrice: { grade: string; price: number } | null;
}

const EMPTY_CARD: ExtractedCard = {
  playerName: '', setName: '', year: '', cardNumber: '',
  variant: '', gradingCompany: '', grade: '', certNumber: '',
};

export default function CardLookupPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string>('image/jpeg');

  const [isParsing, setIsParsing] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedCard | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const [isFetching, setIsFetching] = useState(false);
  const [priceResult, setPriceResult] = useState<PriceResult | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  const [margin, setMargin] = useState('20');

  function handleFile(file: File) {
    setExtracted(null);
    setPriceResult(null);
    setParseError(null);
    setPriceError(null);

    const mt = file.type || 'image/jpeg';
    setMediaType(mt);
    setImagePreview(URL.createObjectURL(file));

    const reader = new FileReader();
    reader.onload = e => {
      const result = e.target?.result as string;
      // Strip data URL prefix to get raw base64
      const base64 = result.split(',')[1];
      setImageBase64(base64);
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

  async function lookupPrice() {
    if (!extracted) return;
    setIsFetching(true);
    setPriceError(null);
    setPriceResult(null);
    try {
      const res = await fetch('/api/admin/card-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'price', ...extracted }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPriceResult(data);
    } catch (err) {
      setPriceError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setIsFetching(false);
    }
  }

  function reset() {
    setImagePreview(null);
    setImageBase64(null);
    setExtracted(null);
    setPriceResult(null);
    setParseError(null);
    setPriceError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const fairValue = priceResult?.matchedPrice?.price ?? null;
  const maxBid = fairValue != null ? fairValue * (1 - parseFloat(margin || '0') / 100) : null;

  const lastComp = priceResult?.comps?.[0] ?? null;

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
            Screenshot an auction listing → AI extracts card details → CardHedger pulls comps
          </p>
        </div>
        {imagePreview && (
          <button
            onClick={reset}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="size-3.5" />
            Start over
          </button>
        )}
      </div>

      {/* Upload zone — shown until an image is loaded */}
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFileChange}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Left — image + extracted fields */}
          <div className="space-y-4">
            {/* Image preview */}
            <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="Listing screenshot" className="w-full object-contain max-h-64" />
            </div>

            {/* Parse button */}
            {!extracted && (
              <button
                onClick={parseScreenshot}
                disabled={isParsing}
                className="w-full py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                {isParsing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Reading listing…
                  </>
                ) : (
                  <>
                    <ScanLine className="size-4" />
                    Parse with AI
                  </>
                )}
              </button>
            )}

            {parseError && (
              <p className="text-sm text-destructive">{parseError}</p>
            )}

            {/* Extracted fields — editable */}
            {extracted && (
              <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Extracted Details</p>

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

                <button
                  onClick={lookupPrice}
                  disabled={isFetching || !extracted.playerName}
                  className="w-full py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  {isFetching ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Looking up…
                    </>
                  ) : (
                    <>
                      <Search className="size-4" />
                      Look Up Price
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Right — results */}
          <div>
            {priceError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                {priceError}
              </div>
            )}

            {isFetching && (
              <div className="rounded-lg border p-12 flex items-center justify-center" style={{ borderColor: 'var(--border)' }}>
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Pulling comps from CardHedger…</p>
                </div>
              </div>
            )}

            {priceResult && !isFetching && (
              <div className="space-y-4">
                {/* Card identity */}
                <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">CardHedger Match</p>
                  <p className="font-bold text-foreground">
                    {priceResult.card.player_name}
                    {priceResult.card.rookie && (
                      <span className="ml-2 text-[9px] font-black px-1.5 py-0.5 rounded uppercase" style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}>
                        RC
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {priceResult.card.year} {priceResult.card.set_name}
                    {priceResult.card.number ? ` #${priceResult.card.number}` : ''}
                    {priceResult.card.variant ? ` · ${priceResult.card.variant}` : ''}
                  </p>
                </div>

                {/* Fair value + last sale */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                      Fair Value ({priceResult.matchedPrice?.grade ?? priceResult.matchedGrade})
                    </p>
                    <p className="text-2xl font-black font-mono text-foreground">
                      {fairValue != null ? formatCurrency(fairValue) : '—'}
                    </p>
                  </div>
                  <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Last Sale</p>
                    <p className="text-2xl font-black font-mono text-foreground">
                      {lastComp ? formatCurrency(lastComp.sale_price) : '—'}
                    </p>
                    {lastComp && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(lastComp.sale_date).toLocaleDateString()} · {lastComp.platform}
                      </p>
                    )}
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
                        min="0"
                        max="100"
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

                {/* All grade prices */}
                {priceResult.prices.length > 0 && (
                  <div className="rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                    <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Grade Prices</p>
                    </div>
                    <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                      {priceResult.prices.map(p => (
                        <div key={p.grade} className="flex items-center justify-between px-4 py-2">
                          <span className="text-sm text-muted-foreground">{p.grade}</span>
                          <span className="text-sm font-mono font-semibold text-foreground">
                            {formatCurrency(parseFloat(String(p.price)))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent comps */}
                {priceResult.comps.length > 0 && (
                  <div className="rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                    <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Recent Comps — {priceResult.matchedGrade} (90 days)
                      </p>
                    </div>
                    <div className="divide-y max-h-52 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                      {priceResult.comps.map((c, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                          <div>
                            <span className="text-foreground font-mono font-semibold">{formatCurrency(c.sale_price)}</span>
                            <span className="text-muted-foreground ml-2 text-xs">{c.grade}</span>
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            <span>{new Date(c.sale_date).toLocaleDateString()}</span>
                            <span className="ml-2">{c.platform}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Placeholder when no results yet */}
            {!priceResult && !isFetching && !priceError && extracted && (
              <div className="rounded-lg border p-12 flex items-center justify-center" style={{ borderColor: 'var(--border)' }}>
                <div className="text-center">
                  <Search className="size-8 mx-auto mb-3 text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">Confirm the details, then click Look Up Price</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  className = '',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </label>
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
