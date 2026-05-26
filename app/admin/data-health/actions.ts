'use server';

import { requireRole } from '@/lib/auth';
import { probeCHForProduct, type CHProbeResult } from '@/lib/ch-coverage';

// Server action wrapper for the per-row "Probe CH live" button on the
// data-health dashboard. Admin/contributor only — same gate as every
// admin route. Errors come back as a structured payload so the button
// can render them inline instead of throwing into the void.
export async function probeProductCHAction(
  productId: string,
): Promise<{ probe?: CHProbeResult; error?: string }> {
  await requireRole('admin', 'contributor');
  try {
    const probe = await probeCHForProduct(productId);
    return { probe };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Probe failed' };
  }
}
