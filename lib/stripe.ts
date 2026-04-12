import Stripe from 'stripe';

// Lazy init — same pattern as Resend
function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-03-25.dahlia',
  });
}

export type SubscriptionPlan = 'hobby' | 'pro';

const PRICE_IDS: Record<SubscriptionPlan, string> = {
  hobby: process.env.STRIPE_PRICE_HOBBY ?? '',
  pro: process.env.STRIPE_PRICE_PRO ?? '',
};

export async function createCheckoutSession(
  userId: string,
  email: string,
  plan: SubscriptionPlan,
): Promise<string> {
  const stripe = getStripe();
  const priceId = PRICE_IDS[plan];
  if (!priceId) throw new Error(`No Stripe price configured for plan: ${plan}`);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://getbreakiq.com';

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/?subscribed=true`,
    cancel_url: `${baseUrl}/subscribe`,
    metadata: { userId, plan },
    subscription_data: {
      metadata: { userId, plan },
    },
  });

  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return session.url;
}

export async function createPortalSession(stripeCustomerId: string): Promise<string> {
  const stripe = getStripe();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://getbreakiq.com';

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${baseUrl}/profile`,
  });

  return session.url;
}

export function constructWebhookEvent(body: string, signature: string): Stripe.Event {
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );
}
