import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { constructWebhookEvent } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Stripe webhook event data shapes (runtime, not SDK types — SDK types drift between versions)
interface CheckoutSession {
  customer?: string | { id: string };
  subscription?: string | { id: string };
  metadata?: Record<string, string>;
}

interface Invoice {
  subscription?: string | { id: string };
  lines?: { data?: Array<{ period?: { end?: number } }> };
}

interface Subscription {
  metadata?: Record<string, string>;
  status: string;
  current_period_end?: number;
}

function resolveId(val: string | { id: string } | undefined | null): string | null {
  if (!val) return null;
  return typeof val === 'string' ? val : val.id;
}

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 });
  }

  let event;
  try {
    event = constructWebhookEvent(body, signature);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as unknown as CheckoutSession;
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan;
        if (!userId || !plan) break;

        await supabaseAdmin.from('profiles').update({
          stripe_customer_id: resolveId(session.customer),
          stripe_subscription_id: resolveId(session.subscription),
          subscription_plan: plan,
          subscription_status: 'active',
          analyses_used: 0,
          analyses_reset_at: new Date().toISOString(),
        }).eq('id', userId);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as unknown as Invoice;
        const subscriptionId = resolveId(invoice.subscription);
        if (!subscriptionId) break;

        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('stripe_subscription_id', subscriptionId)
          .single();

        if (profile) {
          const periodEnd = invoice.lines?.data?.[0]?.period?.end;
          await supabaseAdmin.from('profiles').update({
            analyses_used: 0,
            analyses_reset_at: new Date().toISOString(),
            subscription_status: 'active',
            current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          }).eq('id', profile.id);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as unknown as Subscription;
        const userId = subscription.metadata?.userId;
        if (!userId) break;

        const plan = subscription.metadata?.plan ?? 'hobby';
        const status = subscription.status === 'active' ? 'active'
          : subscription.status === 'past_due' ? 'past_due'
          : subscription.status === 'trialing' ? 'trialing'
          : 'canceled';

        await supabaseAdmin.from('profiles').update({
          subscription_plan: plan,
          subscription_status: status,
          current_period_end: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : null,
        }).eq('id', userId);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as unknown as Subscription;
        const userId = subscription.metadata?.userId;
        if (!userId) break;

        await supabaseAdmin.from('profiles').update({
          subscription_plan: 'free',
          subscription_status: 'canceled',
          stripe_subscription_id: null,
          current_period_end: null,
        }).eq('id', userId);
        break;
      }
    }
  } catch (err) {
    console.error('[stripe-webhook] Error processing event:', event.type, err);
    return NextResponse.json({ error: 'Webhook processing error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
