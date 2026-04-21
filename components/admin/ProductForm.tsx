'use client';

import { useState, useEffect, useRef } from 'react';
import { createProduct, updateProduct, setProductChSetName } from '@/app/admin/products/actions';
import type { Sport, Product } from '@/lib/types';

interface CHSetResult { set_name: string; year: string; category: string; card_count: number; }

interface Props {
  sports: Sport[];
  product?: Product;
  onSaved?: (id: string) => void;
}

const MANUFACTURERS = [
  'Topps',
  'Bowman',
  'Panini',
  'Upper Deck',
  'Leaf',
  'Donruss',
  'Fleer',
  'O-Pee-Chee',
  'Pacific Trading Cards',
  'SkyBox',
  'Pinnacle',
  'Pro Set',
  'In the Game',
  'Tristar',
  'Goodwin & Company',
  'Allen & Ginter',
  'Other',
];

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--terminal-surface-hover)',
  border: '1px solid var(--terminal-border)',
  color: 'var(--text-primary)',
  borderRadius: '0.5rem',
  padding: '0.5rem 0.75rem',
  fontSize: '0.875rem',
  width: '100%',
  outline: 'none',
  transition: 'border-color 150ms',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.625rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight: 700,
  color: 'var(--text-disabled)',
  marginBottom: '0.375rem',
};

function FormInput({
  label,
  hint,
  prefix,
  mono,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  prefix?: string;
  mono?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label style={labelStyle}>
        {label}
        {hint && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}> {hint}</span>}
      </label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>
            {prefix}
          </span>
        )}
        <input
          {...props}
          style={{
            ...inputStyle,
            fontFamily: mono ? 'var(--font-mono)' : undefined,
            paddingLeft: prefix ? '1.5rem' : undefined,
            borderColor: focused ? 'var(--accent-blue)' : 'var(--terminal-border)',
          }}
          onFocus={e => { setFocused(true); props.onFocus?.(e); }}
          onBlur={e => { setFocused(false); props.onBlur?.(e); }}
        />
      </div>
    </div>
  );
}

function FormSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...inputStyle,
          borderColor: focused ? 'var(--accent-blue)' : 'var(--terminal-border)',
          cursor: 'pointer',
          appearance: 'auto',
        }}
      >
        {children}
      </select>
    </div>
  );
}

export default function ProductForm({ sports, product, onSaved }: Props) {
  const [sportId, setSportId] = useState(product?.sport_id ?? '');
  // If the product's existing manufacturer isn't in our list, treat it as "Other"
  const existingMfr = product?.manufacturer ?? '';
  const knownMfr = MANUFACTURERS.filter(m => m !== 'Other').includes(existingMfr);
  const [manufacturer, setManufacturer] = useState(knownMfr || !existingMfr ? existingMfr : 'Other');
  const [manufacturerCustom, setManufacturerCustom] = useState(!knownMfr && existingMfr ? existingMfr : '');
  const [year, setYear] = useState(product?.year ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [slug, setSlug] = useState(product?.slug ?? '');
  const [hobbyCaseCost, setHobbyCaseCost] = useState(product?.hobby_case_cost?.toString() ?? '');
  const [bdCaseCost, setBdCaseCost] = useState(product?.bd_case_cost?.toString() ?? '');
  const [releaseDate, setReleaseDate] = useState(product?.release_date ?? '');
  const [isActive, setIsActive] = useState(product?.is_active ?? false);

  const [chSetName, setChSetName] = useState(product?.ch_set_name ?? '');
  const [setSearchQuery, setSetSearchQuery] = useState('');
  const [setSearchResults, setSetSearchResults] = useState<CHSetResult[]>([]);
  const [setSearching, setSetSearching] = useState(false);
  const [chSetStatus, setChSetStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [nameEdited, setNameEdited] = useState(!!product);
  const [slugEdited, setSlugEdited] = useState(!!product);
  const [status, setStatus] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const autoSearchedRef = useRef(false);

  useEffect(() => {
    if (nameEdited) return;
    const sport = sports.find(s => s.id === sportId);
    if (sport && manufacturer && year) setName(`${year} ${manufacturer} ${sport.name}`);
  }, [sportId, manufacturer, year, nameEdited, sports]);

  useEffect(() => {
    if (slugEdited) return;
    setSlug(slugify(name));
  }, [name, slugEdited]);

  const effectiveManufacturer = manufacturer === 'Other' ? manufacturerCustom : manufacturer;

  // CH's canonical set names rarely include the trailing sport word
  // ("2025 Bowman Chrome" not "2025 Bowman Chrome Baseball"), so strip it
  // when seeding the search from the product's display name.
  function defaultQueryFrom(displayName: string) {
    return displayName
      .replace(/\s+(baseball|basketball|football|soccer|hockey)\s*$/i, '')
      .trim();
  }

  async function searchCHSets(overrideQuery?: string) {
    const q = (overrideQuery ?? setSearchQuery).trim();
    if (!q) return;
    setSetSearching(true);
    setSetSearchResults([]);
    const sport = sports.find(s => s.id === sportId);
    const res = await fetch('/api/admin/set-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, category: sport?.name }),
    });
    const data = await res.json();
    setSetSearchResults(data.sets ?? []);
    setSetSearching(false);
  }

  // For edit forms, selecting a CH set feels like a commit — persist it
  // immediately instead of waiting for full-form Save/Update. For new
  // products (no id yet), we just update local state; createProduct will
  // pick it up on submit.
  async function commitChSetName(nextName: string | null) {
    setChSetName(nextName ?? '');
    if (!product?.id) return;
    setChSetStatus('saving');
    const res = await setProductChSetName(product.id, nextName);
    setChSetStatus(res.error ? 'error' : 'saved');
    if (!res.error) {
      setTimeout(() => setChSetStatus('idle'), 2500);
    }
  }

  // Auto-search on mount (and when the derived name first becomes meaningful)
  // if no ch_set_name is locked in yet. Fires at most once per session.
  useEffect(() => {
    if (autoSearchedRef.current) return;
    if (chSetName) return;
    if (!name.trim() || !sportId) return;
    autoSearchedRef.current = true;
    const seed = defaultQueryFrom(name);
    setSetSearchQuery(seed);
    void searchCHSets(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, sportId, chSetName]);

  async function handleSubmit(publish: boolean) {
    if (publish && !chSetName) {
      setStatus({
        type: 'error',
        message: 'Lock in a CardHedger set name before publishing — matching and pricing rely on it.',
      });
      return;
    }

    setSubmitting(true);
    setStatus(null);

    const data = {
      sport_id: sportId,
      manufacturer: effectiveManufacturer,
      year,
      name,
      slug,
      hobby_case_cost: hobbyCaseCost ? parseFloat(hobbyCaseCost) : null,
      bd_case_cost: bdCaseCost ? parseFloat(bdCaseCost) : null,
      hobby_autos_per_case: null,
      bd_autos_per_case: null,
      release_date: releaseDate || null,
      ch_set_name: chSetName || null,
      is_active: publish ? true : isActive,
    };

    const result = product
      ? await updateProduct(product.id, data)
      : await createProduct(data);

    if ('error' in result) {
      setStatus({ type: 'error', message: result.error ?? 'Unknown error' });
    } else {
      if (publish) setIsActive(true);
      setStatus({ type: 'success', message: product ? 'Product updated.' : 'Product created.' });
      if (!product && 'id' in result) onSaved?.(result.id as string);
    }
    setSubmitting(false);
  }

  const sectionDivider = (
    <div style={{ height: '1px', backgroundColor: 'var(--terminal-border)', margin: '1.5rem 0' }} />
  );

  return (
    <div className="max-w-2xl space-y-0">

      {/* Product Info */}
      <div>
        <p style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, color: 'var(--accent-blue)', marginBottom: '1rem' }}>
          Product Info
        </p>
        <div className="grid grid-cols-2 gap-4">
          <FormSelect label="Sport" value={sportId} onChange={setSportId}>
            <option value="" disabled>Select sport…</option>
            {sports.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </FormSelect>

          <FormSelect label="Manufacturer" value={manufacturer} onChange={setManufacturer}>
            <option value="" disabled>Select manufacturer…</option>
            {MANUFACTURERS.map(m => <option key={m} value={m}>{m}</option>)}
          </FormSelect>
          {manufacturer === 'Other' && (
            <div className="mt-2">
              <FormInput
                label="Custom Manufacturer"
                value={manufacturerCustom}
                onChange={e => setManufacturerCustom(e.target.value)}
                placeholder="Enter manufacturer name"
              />
            </div>
          )}

          <FormInput
            label="Year"
            value={year}
            onChange={e => setYear(e.target.value)}
            placeholder="2025 or 2025-26"
          />

          <FormInput
            label="Display Name"
            hint="(shown to consumers)"
            value={name}
            onChange={e => { setNameEdited(true); setName(e.target.value); }}
            placeholder="Auto-generated"
          />

          <div className="col-span-2">
            <FormInput
              label="Slug"
              hint="(used in URL: /break/slug)"
              value={slug}
              onChange={e => { setSlugEdited(true); setSlug(e.target.value); }}
              mono
            />
          </div>
        </div>
      </div>

      {sectionDivider}

      {/* CardHedger Matching */}
      <div>
        <p style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, color: 'var(--accent-blue)', marginBottom: '0.5rem' }}>
          CardHedger Matching
        </p>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '1rem' }}>
          Set name must match CardHedger exactly. Use the search below to find the canonical name.
        </p>

        {/* Locked-in set name */}
        {chSetName && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)' }}>
            <span style={{ color: 'rgb(34,197,94)', fontSize: '0.75rem' }}>✓</span>
            <span className="text-sm font-mono flex-1" style={{ color: 'var(--text-primary)' }}>{chSetName}</span>
            {chSetStatus === 'saving' && (
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Saving…</span>
            )}
            {chSetStatus === 'saved' && (
              <span className="text-xs" style={{ color: 'rgb(34,197,94)' }}>Saved ✓</span>
            )}
            {chSetStatus === 'error' && (
              <span className="text-xs" style={{ color: 'rgb(239,68,68)' }}>Save failed</span>
            )}
            {chSetStatus === 'idle' && !product?.id && (
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Saves when product is created</span>
            )}
            <button
              type="button"
              onClick={() => { void commitChSetName(null); setSetSearchResults([]); }}
              className="text-xs hover:underline"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Clear
            </button>
          </div>
        )}

        {/* Set search */}
        <div className="flex gap-2">
          <input
            value={setSearchQuery}
            onChange={e => setSetSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchCHSets(); }}}
            placeholder={`e.g. "${name || '2025 Bowman Chrome'}"`}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            type="button"
            onClick={() => searchCHSets()}
            disabled={setSearching || !setSearchQuery.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 whitespace-nowrap"
            style={{ backgroundColor: 'var(--accent-blue)', color: 'white' }}
          >
            {setSearching ? 'Searching…' : 'Find on CH'}
          </button>
        </div>

        {/* Results */}
        {setSearchResults.length > 0 && (
          <>
            <p className="mt-2 mb-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {setSearchResults.length === 1
                ? '1 match found — click to lock it in.'
                : `${setSearchResults.length} matches found — top result highlighted. Click any row to lock in a different one.`}
            </p>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--terminal-border)' }}>
              {setSearchResults.map((s, idx) => {
                const isTop = idx === 0;
                return (
                  <button
                    key={s.set_name}
                    type="button"
                    onClick={() => { void commitChSetName(s.set_name); setSetSearchResults([]); setSetSearchQuery(''); }}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-[var(--terminal-surface-hover)] border-b last:border-0"
                    style={{
                      borderColor: 'var(--terminal-border)',
                      backgroundColor: isTop ? 'rgba(59,130,246,0.08)' : undefined,
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isTop && (
                        <span
                          className="text-[0.625rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0"
                          style={{ backgroundColor: 'var(--accent-blue)', color: 'white' }}
                        >
                          Top match
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-mono truncate" style={{ color: 'var(--text-primary)' }}>{s.set_name}</p>
                        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{s.year} · {s.category}</p>
                      </div>
                    </div>
                    <span className="text-xs font-mono ml-4 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                      {s.card_count?.toLocaleString()} cards
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {setSearchResults.length === 0 && !setSearching && setSearchQuery && autoSearchedRef.current && (
          <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            No results — try a shorter query or check the set name spelling.
          </p>
        )}
      </div>

      {sectionDivider}

      {/* Pricing */}
      <div>
        <p style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, color: 'var(--accent-blue)', marginBottom: '1rem' }}>
          Pricing
        </p>
        <div className="grid grid-cols-2 gap-4">
          <FormInput label="Hobby / Case" value={hobbyCaseCost} onChange={e => setHobbyCaseCost(e.target.value)} prefix="$" placeholder="1200" type="number" mono />
          <FormInput label="BD / Case" value={bdCaseCost} onChange={e => setBdCaseCost(e.target.value)} prefix="$" placeholder="Optional" type="number" mono />
          <FormInput
            label="Release Date"
            hint="(used for pre-release banner)"
            value={releaseDate}
            onChange={e => setReleaseDate(e.target.value)}
            type="date"
            mono
          />
        </div>
      </div>

      {sectionDivider}

      {/* Status toggle */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={isActive}
          onClick={() => setIsActive(v => !v)}
          className="relative h-5 w-9 rounded-full transition-colors focus:outline-none"
          style={{ backgroundColor: isActive ? 'var(--accent-blue)' : 'var(--terminal-surface-active)' }}
        >
          <span
            className="block h-4 w-4 rounded-full bg-white shadow transition-transform"
            style={{ transform: isActive ? 'translateX(1.25rem)' : 'translateX(0.125rem)' }}
          />
        </button>
        <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Active (visible on homepage)
        </label>
      </div>

      {status && (
        <p className="text-sm" style={{ color: status.type === 'error' ? 'var(--signal-pass)' : 'var(--signal-buy)' }}>
          {status.message}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => handleSubmit(false)}
          disabled={submitting}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
          style={{
            border: '1px solid var(--terminal-border)',
            backgroundColor: 'var(--terminal-surface-hover)',
            color: 'var(--text-secondary)',
          }}
        >
          Save Draft
        </button>
        <button
          type="button"
          onClick={() => handleSubmit(true)}
          disabled={submitting}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 hover:scale-[1.02]"
          style={{
            background: 'var(--gradient-blue)',
            color: 'white',
            boxShadow: 'var(--glow-blue)',
          }}
        >
          {submitting ? 'Saving…' : 'Publish'}
        </button>
      </div>
    </div>
  );
}
