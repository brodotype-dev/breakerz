'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import {
  deleteProduct,
  getProductDeletionPreview,
  type ProductDeletionPreview,
} from '../../actions';

// Destructive "Delete Product" affordance. Lives at the bottom of the
// edit page, isolated visually so admin can't fat-finger it.
//
// Flow:
//   1. Loads a deletion preview on mount — counts of every dependent
//      row (player_products, variants, market_observations, consumer
//      breaks) plus a hard-block reason if any consumer data exists.
//   2. Renders the counts so admin sees what cascades before they
//      confirm.
//   3. Type-to-confirm input — must match the product name exactly
//      (whitespace-trimmed). Button stays disabled otherwise.
//   4. On success, navigates back to /admin/products.

export default function DangerZone({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<ProductDeletionPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getProductDeletionPreview(productId);
      if (cancelled) return;
      if (res.error) setLoadError(res.error);
      else if (res.preview) setPreview(res.preview);
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const blocked = preview?.blockReason != null;
  const nameMatches = typed.trim() === productName;
  const canDelete = preview != null && !blocked && nameMatches && !deleting;

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteProduct(productId, productName);
    if (res.error) {
      setDeleteError(res.error);
      setDeleting(false);
      return;
    }
    router.push('/admin/products');
  }

  return (
    <section
      className="rounded-xl overflow-hidden"
      style={{
        border: '1px solid rgba(239, 68, 68, 0.35)',
        backgroundColor: 'rgba(239, 68, 68, 0.04)',
      }}
    >
      <div className="h-1" style={{ background: 'linear-gradient(135deg, #ef4444 0%, #f59e0b 100%)' }} />
      <div className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)' }}
          >
            <AlertTriangle className="w-4 h-4" style={{ color: '#fca5a5' }} />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest" style={{ color: '#fca5a5' }}>
              Danger Zone
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Permanently delete this product and every row that depends on it. Use this for bad
              imports or products with too little information to ship. If consumers have already
              logged breaks, deactivate it instead (toggle Active off above).
            </p>
          </div>
        </div>

        {/* Preview state */}
        {loadError && (
          <p className="text-xs" style={{ color: '#fca5a5' }}>
            Failed to load deletion preview: {loadError}
          </p>
        )}
        {!preview && !loadError && (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <Loader2 className="w-3 h-3 animate-spin" />
            Counting dependent rows…
          </div>
        )}

        {preview && (
          <>
            <div
              className="rounded-lg border p-3 text-xs space-y-1"
              style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)' }}
            >
              <p className="font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                What this deletes
              </p>
              <Row label="Player products" count={preview.counts.playerProducts} />
              <Row label="Variants" count={preview.counts.variants} />
              <Row label="Market observations (Discord /break-price)" count={preview.counts.marketObservations} />
              <Row label="Chase cards" count={preview.counts.chaseCards} />
              <p className="pt-2 mt-2 border-t" style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-tertiary)' }}>
                Kept (unlinked): {preview.counts.pricingFeedback} pricing-feedback row(s).
              </p>
            </div>

            {blocked ? (
              <div
                className="rounded-lg border p-3 text-xs"
                style={{
                  borderColor: 'rgba(239, 68, 68, 0.45)',
                  backgroundColor: 'rgba(239, 68, 68, 0.10)',
                  color: '#fecaca',
                }}
              >
                <p className="font-bold mb-1">Delete blocked</p>
                <p>{preview.blockReason}</p>
              </div>
            ) : (
              <>
                <div>
                  <label
                    className="block text-xs font-medium mb-1"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Type the product name to confirm
                  </label>
                  <input
                    type="text"
                    value={typed}
                    onChange={e => setTyped(e.target.value)}
                    placeholder={productName}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-md border px-3 py-2 text-sm font-mono"
                    style={{
                      borderColor: nameMatches
                        ? 'rgba(34, 197, 94, 0.4)'
                        : 'var(--terminal-border)',
                      backgroundColor: 'var(--terminal-bg)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>

                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={!canDelete}
                  className="w-full h-10 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.18)',
                    border: '1px solid rgba(239, 68, 68, 0.5)',
                    color: '#fecaca',
                  }}
                >
                  {deleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting…
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Delete {productName}
                    </>
                  )}
                </button>

                {deleteError && (
                  <p className="text-xs" style={{ color: '#fca5a5' }}>
                    {deleteError}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Row({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
        {count.toLocaleString()}
      </span>
    </div>
  );
}
