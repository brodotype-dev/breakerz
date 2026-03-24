'use client';

import { useState, useEffect } from 'react';
import { Switch } from '@base-ui/react/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createProduct, updateProduct } from '@/app/admin/products/actions';
import type { Sport, Product } from '@/lib/types';

interface Props {
  sports: Sport[];
  product?: Product;
  onSaved?: (id: string) => void;
}

const MANUFACTURERS = ['Topps', 'Bowman', 'Panini', 'Upper Deck', 'Leaf', 'Donruss', 'Fleer'];

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export default function ProductForm({ sports, product, onSaved }: Props) {
  const [sportId, setSportId] = useState(product?.sport_id ?? '');
  const [manufacturer, setManufacturer] = useState(product?.manufacturer ?? '');
  const [year, setYear] = useState(product?.year ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [slug, setSlug] = useState(product?.slug ?? '');
  const [hobbyCaseCost, setHobbyCaseCost] = useState(
    product?.hobby_case_cost?.toString() ?? ''
  );
  const [bdCaseCost, setBdCaseCost] = useState(product?.bd_case_cost?.toString() ?? '');
  const [hobbyAutos, setHobbyAutos] = useState(
    product?.hobby_autos_per_case?.toString() ?? '16'
  );
  const [bdAutos, setBdAutos] = useState(product?.bd_autos_per_case?.toString() ?? '');
  const [isActive, setIsActive] = useState(product?.is_active ?? false);

  const [nameEdited, setNameEdited] = useState(!!product);
  const [slugEdited, setSlugEdited] = useState(!!product);
  const [status, setStatus] = useState<{ type: 'error' | 'success'; message: string } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);

  // Auto-generate name from sport + manufacturer + year
  useEffect(() => {
    if (nameEdited) return;
    const sport = sports.find((s) => s.id === sportId);
    if (sport && manufacturer && year) {
      setName(`${year} ${manufacturer} ${sport.name}`);
    }
  }, [sportId, manufacturer, year, nameEdited, sports]);

  // Auto-generate slug from name
  useEffect(() => {
    if (slugEdited) return;
    setSlug(slugify(name));
  }, [name, slugEdited]);

  async function handleSubmit(publish: boolean) {
    setSubmitting(true);
    setStatus(null);

    const data = {
      sport_id: sportId,
      manufacturer,
      year,
      name,
      slug,
      hobby_case_cost: hobbyCaseCost ? parseFloat(hobbyCaseCost) : null,
      bd_case_cost: bdCaseCost ? parseFloat(bdCaseCost) : null,
      hobby_autos_per_case: hobbyAutos ? parseInt(hobbyAutos) : null,
      bd_autos_per_case: bdAutos ? parseInt(bdAutos) : null,
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
      if (!product && 'id' in result) {
        onSaved?.(result.id as string);
      }
    }

    setSubmitting(false);
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Identity */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-3 font-semibold">
          Product Info
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-semibold">
              Sport
            </label>
            <Select value={sportId} onValueChange={(v) => setSportId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select sport…" />
              </SelectTrigger>
              <SelectContent>
                {sports.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-semibold">
              Manufacturer
            </label>
            <Input
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              list="manufacturers-list"
              placeholder="Topps"
            />
            <datalist id="manufacturers-list">
              {MANUFACTURERS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-semibold">
              Year
            </label>
            <Input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2025 or 2025-26"
            />
          </div>

          <div>
            <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-semibold">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => {
                setNameEdited(true);
                setName(e.target.value);
              }}
              placeholder="Auto-generated"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-semibold">
              Slug{' '}
              <span className="normal-case font-normal text-muted-foreground/60">
                (used in URL: /break/slug)
              </span>
            </label>
            <Input
              value={slug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value);
              }}
              className="font-mono text-sm"
            />
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div className="border-t pt-5">
        <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-3 font-semibold">
          Pricing
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Hobby / Case"
            value={hobbyCaseCost}
            onChange={setHobbyCaseCost}
            prefix="$"
            placeholder="1200"
            type="number"
          />
          <Field
            label="BD / Case"
            value={bdCaseCost}
            onChange={setBdCaseCost}
            prefix="$"
            placeholder="Optional"
            type="number"
          />
          <Field
            label="Hobby Autos / Case"
            value={hobbyAutos}
            onChange={setHobbyAutos}
            placeholder="16"
            type="number"
          />
          <Field
            label="BD Autos / Case"
            value={bdAutos}
            onChange={setBdAutos}
            placeholder="Optional"
            type="number"
          />
        </div>
      </div>

      {/* Status */}
      <div className="border-t pt-5 flex items-center gap-3">
        <Switch.Root
          checked={isActive}
          onCheckedChange={setIsActive}
          className="relative h-5 w-9 cursor-pointer rounded-full bg-border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring data-[checked]:bg-[oklch(0.28_0.08_250)]"
        >
          <Switch.Thumb className="block size-4 rounded-full bg-white shadow transition-transform translate-x-0.5 data-[checked]:translate-x-4" />
        </Switch.Root>
        <label className="text-sm font-medium">Active (visible on homepage)</label>
      </div>

      {status && (
        <p
          className={`text-sm ${status.type === 'error' ? 'text-destructive' : 'text-green-600'}`}
        >
          {status.message}
        </p>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => handleSubmit(false)} disabled={submitting}>
          Save Draft
        </Button>
        <Button onClick={() => handleSubmit(true)} disabled={submitting}>
          Publish
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  prefix,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-semibold">
        {label}
      </label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none z-10">
            {prefix}
          </span>
        )}
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="font-mono text-sm"
          style={{ paddingLeft: prefix ? '1.5rem' : undefined }}
        />
      </div>
    </div>
  );
}
