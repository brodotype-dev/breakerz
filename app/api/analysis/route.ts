import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createClient } from '@/lib/supabase-server';
import { runBreakAnalysis } from '@/lib/analysis';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { productId, team, askPrice, breakType = 'hobby', numCases = 10 } = await req.json();
    if (!productId || !team || askPrice == null) {
      return NextResponse.json({ error: 'productId, team, and askPrice required' }, { status: 400 });
    }

    const result = await runBreakAnalysis({
      productId,
      team,
      askPrice: parseFloat(askPrice),
      breakType,
      numCases: parseInt(numCases) || 10,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET — return active products and their teams (for the analysis page dropdowns)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: products } = await supabaseAdmin
    .from('products')
    .select('id, name, year, sport:sports(name), hobby_case_cost, bd_case_cost')
    .eq('is_active', true)
    .order('name');

  return NextResponse.json({ products: products ?? [] });
}
