import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { createCheckoutSession, createPortalSession } from '@/lib/stripe';
import type { SubscriptionPlan } from '@/lib/stripe';

const VALID_PLANS: SubscriptionPlan[] = ['hobby', 'pro'];

// POST — create a Stripe Checkout session
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { plan } = await req.json();
  if (!VALID_PLANS.includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }

  try {
    const url = await createCheckoutSession(user.id, user.email!, plan);
    return NextResponse.json({ url });
  } catch (err) {
    console.error('[checkout] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Checkout failed' },
      { status: 500 }
    );
  }
}

// GET — create a Stripe Customer Portal session (manage subscription)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();

  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
  }

  try {
    const url = await createPortalSession(profile.stripe_customer_id);
    return NextResponse.json({ url });
  } catch (err) {
    console.error('[checkout-portal] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Portal session failed' },
      { status: 500 }
    );
  }
}
