/**
 * /api/pricing — consumer-facing pricing read.
 *
 * Both GET and POST return cached pricing only. POST exists for frontend
 * compatibility with the old "Refresh" button, but it no longer triggers a
 * live CardHedger fetch — that job moved to:
 *
 *   - `POST /api/admin/refresh-product-pricing`  (admin-on-demand, one product)
 *   - `/api/cron/refresh-pricing`                (nightly fan-out, all active)
 *
 * Reason: at 6,000+ variants per product × CH's 5-30s batch latency, we could
 * never finish a live refresh inside Vercel Hobby's 60s cap. Eight iterations
 * of the old POST pipeline ended in the same 504. See CHANGELOG 2026-04-22.
 *
 * The cached DB read lives in `lib/pricing-read.ts` so the new break-page
 * server component can call it directly without going through an internal
 * HTTP round-trip. This route stays alive for the admin BreakerComparisonPanel
 * caller.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { loadCached } from '@/lib/pricing-read';

async function checkAuth(req: NextRequest) {
  if (process.env.NODE_ENV === 'development') return true;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return !!user;
}

export async function GET(req: NextRequest) {
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const productId = req.nextUrl.searchParams.get('productId');
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });
  try {
    const players = await loadCached(productId);
    return NextResponse.json({ players });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { productId } = await req.json();
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });
  try {
    const players = await loadCached(productId);
    return NextResponse.json({ players });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
