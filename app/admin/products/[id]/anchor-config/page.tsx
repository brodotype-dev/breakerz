import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getManufacturerDescriptor } from '@/lib/card-knowledge';
import type { AnchorStrategy } from '@/lib/pricing-anchors';
import AnchorConfigClient from './AnchorConfigClient';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string }> };

/**
 * Conversational anchor-strategy configurator.
 *
 * Admin describes which variants should anchor slot prices for this product;
 * Claude proposes a strategy + regex patterns; live preview shows current vs proposed
 * EV for the top 5 players (no CH calls); save persists to products.anchor_*.
 *
 * Plan: docs/plans/2026-05-11-per-product-anchor-configurator.md
 */
export default async function AnchorConfigPage({ params }: PageProps) {
  await requireRole('admin', 'contributor');

  const { id: productId } = await params;

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('id, name, year, lifecycle_status, anchor_strategy, anchor_variant_patterns, anchor_config_notes')
    .eq('id', productId)
    .single();

  if (!product) notFound();

  const descriptor = getManufacturerDescriptor(product.name);

  // Variant-sample count for the "data readiness" hint above the chat.
  const { count: variantCount } = await supabaseAdmin
    .from('player_product_variants')
    .select('id, player_products!inner(product_id)', { count: 'exact', head: true })
    .eq('player_products.product_id', productId);

  const currentStrategy = (product.anchor_strategy ?? 'sets_weighted_all') as AnchorStrategy;
  const currentPatterns: string[] = Array.isArray(product.anchor_variant_patterns)
    ? (product.anchor_variant_patterns as string[])
    : [];

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/admin/products/${productId}`}
            className="text-xs uppercase tracking-widest hover:underline"
            style={{ color: 'var(--text-tertiary)' }}
          >
            ← {product.name}
          </Link>
          <h1 className="text-2xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>
            Anchor Configurator
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {descriptor.name} family · {variantCount ?? 0} variants imported · lifecycle: {product.lifecycle_status ?? 'unknown'}
          </p>
        </div>
      </div>

      <div
        className="rounded-xl p-4 text-sm"
        style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-secondary)' }}
      >
        <p className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>How this works</p>
        <ol className="list-decimal ml-5 space-y-1">
          <li>Describe in plain English which variants should drive slot prices for this product.</li>
          <li>Claude proposes a strategy + regex patterns and shows you what slot prices would change.</li>
          <li>Iterate. Save when the numbers match Kyle&apos;s gut.</li>
          <li>Save = publish. Next pricing refresh (within 24h, or hit &quot;Refresh Pricing&quot; on the product page) applies it.</li>
        </ol>
      </div>

      <AnchorConfigClient
        productId={productId}
        productName={product.name}
        descriptorName={descriptor.name}
        anchorConcepts={descriptor.anchorConcepts ?? []}
        initialStrategy={currentStrategy}
        initialPatterns={currentPatterns}
        initialNotes={product.anchor_config_notes ?? ''}
      />
    </div>
  );
}
