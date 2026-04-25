'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, BarChart2, LayoutDashboard, CheckCircle, Search } from 'lucide-react';
import type { Sport } from '@/lib/types';
import { createProduct } from './actions';

interface ChSetSearchResult {
  set_name: string;
  year?: string | number;
  category?: string;
  thirty_day_sales?: number;
}

/** CH's canonical set names rarely include the trailing sport word
 *  ("2025 Bowman Chrome" not "2025 Bowman Chrome Baseball"), so strip it
 *  when seeding the search from the product's display name. */
function defaultQueryFrom(displayName: string) {
  return displayName
    .replace(/\s+(baseball|basketball|football|soccer|hockey)\s*$/i, '')
    .trim();
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

interface Props {
  sports: Sport[];
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
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.625rem',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  fontWeight: 700,
  color: 'var(--text-disabled)',
  marginBottom: '0.375rem',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.625rem',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.12em',
  fontWeight: 700,
  color: 'var(--accent-blue)',
  marginBottom: '0.75rem',
};

function FocusInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      style={{ ...inputStyle, borderColor: focused ? 'var(--accent-blue)' : 'var(--terminal-border)', ...(props.style ?? {}) }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

function FocusSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      {...props}
      style={{ ...inputStyle, borderColor: focused ? 'var(--accent-blue)' : 'var(--terminal-border)', cursor: 'pointer' }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

export default function NewProductForm({ sports }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState('');

  const [form, setForm] = useState({
    name: '',
    sport_id: sports[0]?.id ?? '',
    manufacturer: '',
    manufacturerCustom: '',
    year: new Date().getFullYear().toString(),
    hobby_case_cost: '',
    bd_case_cost: '',
    hobby_am_case_cost: '',
    bd_am_case_cost: '',
  });

  // CardHedger set picker state
  const [chSetName, setChSetName] = useState('');
  const [setSearchQuery, setSetSearchQuery] = useState('');
  const [setSearchResults, setSetSearchResults] = useState<ChSetSearchResult[]>([]);
  const [setSearching, setSetSearching] = useState(false);
  const autoSearchedRef = useRef(false);

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  const effectiveManufacturer =
    form.manufacturer === 'Other' ? form.manufacturerCustom : form.manufacturer;

  async function searchCHSets(overrideQuery?: string) {
    const q = (overrideQuery ?? setSearchQuery).trim();
    if (!q) return;
    setSetSearching(true);
    setSetSearchResults([]);
    const sport = sports.find(s => s.id === form.sport_id);
    try {
      const res = await fetch('/api/admin/set-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, category: sport?.name }),
      });
      const data = await res.json();
      setSetSearchResults(data.sets ?? []);
    } catch (err) {
      console.error('CH set search failed:', err);
      setSetSearchResults([]);
    } finally {
      setSetSearching(false);
    }
  }

  // Auto-search once the product name + sport are filled in. Mirrors the
  // edit form behavior so the admin sees CH matches the moment they have
  // enough info to search.
  useEffect(() => {
    if (autoSearchedRef.current) return;
    if (chSetName) return;
    if (!form.name.trim() || !form.sport_id) return;
    autoSearchedRef.current = true;
    const seed = defaultQueryFrom(form.name);
    setSetSearchQuery(seed);
    void searchCHSets(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.name, form.sport_id, chSetName]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveManufacturer.trim()) {
      setError('Manufacturer is required.');
      return;
    }
    setLoading(true);
    setError('');

    const result = await createProduct({
      name: form.name.trim(),
      sport_id: form.sport_id,
      manufacturer: effectiveManufacturer.trim(),
      year: form.year.trim(),
      hobby_case_cost: parseFloat(form.hobby_case_cost) || 0,
      bd_case_cost: form.bd_case_cost ? parseFloat(form.bd_case_cost) : null,
      hobby_am_case_cost: form.hobby_am_case_cost ? parseFloat(form.hobby_am_case_cost) : null,
      bd_am_case_cost: form.bd_am_case_cost ? parseFloat(form.bd_am_case_cost) : null,
      hobby_autos_per_case: null,
      bd_autos_per_case: null,
      release_date: null,
      ch_set_name: chSetName || null,
    });

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setCreatedId(result.id ?? null);
    setCreatedName(form.name.trim());
    setLoading(false);
  }

  // ── Success / Next Steps ──────────────────────────────────────────
  if (createdId) {
    return (
      <div className="space-y-6">
        {/* Confirmation */}
        <div
          className="flex items-center gap-3 p-4 rounded-xl"
          style={{ backgroundColor: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }}
        >
          <CheckCircle className="w-5 h-5 shrink-0" style={{ color: 'var(--signal-buy)' }} />
          <div>
            <p className="font-semibold text-sm" style={{ color: 'var(--signal-buy)' }}>
              Product created
            </p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {createdName}
            </p>
          </div>
        </div>

        {/* Next steps */}
        <div>
          <p style={sectionLabelStyle}>Next Steps</p>
          <div className="space-y-3">
            <NextStep
              href={`/admin/import-checklist?productId=${createdId}`}
              icon={FileText}
              title="Import Checklist"
              description="Upload the player checklist — PDF or CSV"
              accent="var(--accent-blue)"
              gradient="var(--gradient-blue)"
              primary
            />
            <NextStep
              href={`/admin/products/${createdId}`}
              icon={BarChart2}
              title="Upload Odds"
              description="Add hobby odds PDF from the product dashboard"
              accent="var(--accent-orange)"
              gradient="var(--gradient-orange)"
            />
            <NextStep
              href={`/admin/products/${createdId}`}
              icon={LayoutDashboard}
              title="Go to Dashboard"
              description="View readiness, run CardHedger matching, manage players"
              accent="var(--text-tertiary)"
              gradient="none"
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">

      {/* Product Info */}
      <div>
        <p style={sectionLabelStyle}>Product Info</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label style={labelStyle}>Product Name</label>
            <FocusInput
              type="text"
              required
              placeholder="e.g. 2025-26 Topps Finest Basketball"
              value={form.name}
              onChange={e => set('name', e.target.value)}
            />
          </div>

          <div>
            <label style={labelStyle}>Sport</label>
            <FocusSelect
              required
              value={form.sport_id}
              onChange={e => set('sport_id', e.target.value)}
            >
              {sports.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </FocusSelect>
          </div>

          <div>
            <label style={labelStyle}>Manufacturer</label>
            <FocusSelect
              required
              value={form.manufacturer}
              onChange={e => set('manufacturer', e.target.value)}
            >
              <option value="" disabled>Select manufacturer…</option>
              {MANUFACTURERS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </FocusSelect>
            {form.manufacturer === 'Other' && (
              <FocusInput
                type="text"
                placeholder="Enter manufacturer name"
                value={form.manufacturerCustom}
                onChange={e => set('manufacturerCustom', e.target.value)}
                style={{ marginTop: '0.5rem' }}
              />
            )}
          </div>

          <div>
            <label style={labelStyle}>Year</label>
            <FocusInput
              type="text"
              required
              placeholder="e.g. 2025-26"
              value={form.year}
              onChange={e => set('year', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* CardHedger Matching */}
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <p style={sectionLabelStyle}>CardHedger Matching</p>
          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Optional — required to publish</span>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Set name must match CardHedger exactly. Search auto-runs from the product name.
        </p>

        {/* Locked-in set */}
        {chSetName && (
          <div
            className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg"
            style={{ backgroundColor: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)' }}
          >
            <CheckCircle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--signal-buy)' }} />
            <span className="text-sm font-mono flex-1" style={{ color: 'var(--text-primary)' }}>{chSetName}</span>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Saves on create</span>
            <button
              type="button"
              onClick={() => { setChSetName(''); setSetSearchResults([]); }}
              className="text-xs hover:underline"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Clear
            </button>
          </div>
        )}

        {/* Search input */}
        <div className="flex gap-2">
          <div
            className="flex items-center gap-2 flex-1 px-3 rounded-lg"
            style={{ ...inputStyle, padding: 0 }}
          >
            <Search className="w-3.5 h-3.5 ml-3 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              value={setSearchQuery}
              onChange={e => setSetSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchCHSets(); } }}
              placeholder={`e.g. "${form.name || '2025 Bowman Chrome'}"`}
              className="flex-1 bg-transparent border-0 outline-none text-sm py-2 placeholder:text-muted-foreground"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
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
                : `${setSearchResults.length} matches — top result highlighted.`}
            </p>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--terminal-border)' }}>
              {setSearchResults.map((s, idx) => {
                const isTop = idx === 0;
                return (
                  <button
                    key={s.set_name}
                    type="button"
                    onClick={() => { setChSetName(s.set_name); setSetSearchResults([]); setSetSearchQuery(''); }}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-[var(--terminal-surface-hover)] border-b last:border-0"
                    style={{
                      borderColor: 'var(--terminal-border)',
                      backgroundColor: isTop ? 'rgba(59,130,246,0.08)' : undefined,
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isTop && (
                        <span
                          className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
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
                    {s.thirty_day_sales ? (
                      <span className="text-xs font-mono ml-4 shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                        {s.thirty_day_sales.toLocaleString()} sales / 30d
                      </span>
                    ) : null}
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

      {/* Case Costs */}
      <div>
        <p style={sectionLabelStyle}>Case Costs</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label style={labelStyle}>Hobby / Case ($)</label>
            <FocusInput
              type="number"
              required
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.hobby_case_cost}
              onChange={e => set('hobby_case_cost', e.target.value)}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <div>
            <label style={labelStyle}>
              BD / Case ($){' '}
              <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
            </label>
            <FocusInput
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.bd_case_cost}
              onChange={e => set('bd_case_cost', e.target.value)}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <div>
            <label style={labelStyle}>
              Hobby AM / Case ($){' '}
              <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(after-market, optional)</span>
            </label>
            <FocusInput
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.hobby_am_case_cost}
              onChange={e => set('hobby_am_case_cost', e.target.value)}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <div>
            <label style={labelStyle}>
              BD AM / Case ($){' '}
              <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(after-market, optional)</span>
            </label>
            <FocusInput
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.bd_am_case_cost}
              onChange={e => set('bd_am_case_cost', e.target.value)}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm" style={{ color: 'var(--signal-pass)' }}>{error}</p>
      )}

      <button
        type="submit"
        disabled={loading || !form.name || !form.manufacturer}
        className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-40 hover:scale-[1.02]"
        style={{ background: 'var(--gradient-green)', boxShadow: 'var(--glow-green)' }}
      >
        {loading ? 'Creating…' : 'Create Product →'}
      </button>
    </form>
  );
}

function NextStep({
  href,
  icon: Icon,
  title,
  description,
  accent,
  gradient,
  primary,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
  accent: string;
  gradient: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 p-4 rounded-xl transition-all hover:scale-[1.01]"
      style={{
        border: `1px solid ${primary ? accent + '40' : 'var(--terminal-border)'}`,
        backgroundColor: primary ? `${accent}0d` : 'var(--terminal-surface-hover)',
      }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
        style={{
          background: gradient !== 'none' ? gradient : 'var(--terminal-surface-active)',
          boxShadow: gradient !== 'none' ? `0 0 15px ${accent}30` : undefined,
        }}
      >
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm" style={{ color: primary ? accent : 'var(--text-primary)' }}>
          {title}
        </p>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {description}
        </p>
      </div>
      <span className="text-lg" style={{ color: 'var(--text-tertiary)' }}>→</span>
    </Link>
  );
}
