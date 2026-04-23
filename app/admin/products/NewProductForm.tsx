'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileText, BarChart2, LayoutDashboard, CheckCircle } from 'lucide-react';
import type { Sport } from '@/lib/types';
import { createProduct } from './actions';

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

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  const effectiveManufacturer =
    form.manufacturer === 'Other' ? form.manufacturerCustom : form.manufacturer;

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
