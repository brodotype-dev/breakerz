'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Sport } from '@/lib/types';
import { createProduct } from './actions';

interface Props {
  sports: Sport[];
}

export default function NewProductForm({ sports }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '',
    sport_id: sports[0]?.id ?? '',
    manufacturer: '',
    year: new Date().getFullYear().toString(),
    hobby_case_cost: '',
    bd_case_cost: '',
    hobby_autos_per_case: '',
    bd_autos_per_case: '',
  });

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await createProduct({
      name: form.name.trim(),
      sport_id: form.sport_id,
      manufacturer: form.manufacturer.trim(),
      year: form.year.trim(),
      hobby_case_cost: parseFloat(form.hobby_case_cost) || 0,
      bd_case_cost: form.bd_case_cost ? parseFloat(form.bd_case_cost) : null,
      hobby_autos_per_case: parseInt(form.hobby_autos_per_case) || 0,
      bd_autos_per_case: form.bd_autos_per_case ? parseInt(form.bd_autos_per_case) : null,
      release_date: null,
    });

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    if (result.id) {
      router.push(`/admin/products/${result.id}`);
    } else {
      router.push('/admin/products');
    }
  }

  const inputClass =
    'w-full rounded border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary';
  const labelClass = 'block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Name */}
        <div className="sm:col-span-2">
          <label className={labelClass}>Product Name</label>
          <input
            type="text"
            required
            placeholder="e.g. 2025-26 Topps Finest Basketball"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            className={inputClass}
          />
        </div>

        {/* Sport */}
        <div>
          <label className={labelClass}>Sport</label>
          <select
            required
            value={form.sport_id}
            onChange={e => set('sport_id', e.target.value)}
            className={inputClass}
          >
            {sports.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Manufacturer */}
        <div>
          <label className={labelClass}>Manufacturer</label>
          <input
            type="text"
            required
            placeholder="e.g. Topps"
            value={form.manufacturer}
            onChange={e => set('manufacturer', e.target.value)}
            className={inputClass}
          />
        </div>

        {/* Year */}
        <div>
          <label className={labelClass}>Year</label>
          <input
            type="text"
            required
            placeholder="e.g. 2025-26"
            value={form.year}
            onChange={e => set('year', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Case costs */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Case Costs</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Hobby / Case ($)</label>
            <input
              type="number"
              required
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.hobby_case_cost}
              onChange={e => set('hobby_case_cost', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>BD / Case ($) <span className="text-muted-foreground font-normal normal-case tracking-normal">(optional)</span></label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.bd_case_cost}
              onChange={e => set('bd_case_cost', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Autos per case */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Autos / Case</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Hobby</label>
            <input
              type="number"
              required
              min="0"
              step="1"
              placeholder="0"
              value={form.hobby_autos_per_case}
              onChange={e => set('hobby_autos_per_case', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>BD <span className="text-muted-foreground font-normal normal-case tracking-normal">(optional)</span></label>
            <input
              type="number"
              min="0"
              step="1"
              placeholder="0"
              value={form.bd_autos_per_case}
              onChange={e => set('bd_autos_per_case', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={loading || !form.name || !form.manufacturer}
        className="rounded bg-[oklch(0.28_0.08_250)] px-4 py-2 text-sm font-bold text-white hover:bg-[oklch(0.22_0.08_250)] disabled:opacity-50 transition-colors"
      >
        {loading ? 'Adding…' : 'Add Product →'}
      </button>
    </form>
  );
}
