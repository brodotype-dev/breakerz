import { NextRequest, NextResponse } from 'next/server';
import { checkRole } from '@/lib/auth';
import { parseUpperDeckUrl } from '@/lib/upper-deck-parser';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { url } = (await req.json()) as { url?: string };
  if (!url || !/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: 'Valid url required' }, { status: 400 });
  }

  try {
    // parseUpperDeckUrl caches the Firecrawl scrape per URL for 5 min,
    // so back-to-back checklist + odds imports against the same URL
    // only spend one network call.
    const { odds } = await parseUpperDeckUrl(url);
    return NextResponse.json({ odds });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Parse failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
