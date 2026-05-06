import { PostHog } from 'posthog-node';
import type { PHEvent } from './posthog-events';

let posthogClient: PostHog | null = null;

export function getPostHogClient() {
  if (!posthogClient) {
    posthogClient = new PostHog(
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!,
      {
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
        flushAt: 1,
        flushInterval: 0,
      }
    );
  }
  return posthogClient;
}

// Awaited capture for serverless environments. PostHog Node queues async, so on
// Vercel Functions the process can exit before the network call completes.
// Always await this in API routes / webhooks / server actions.
export async function captureServer(args: {
  distinctId: string;
  event: PHEvent;
  properties?: Record<string, unknown>;
  setProperties?: Record<string, unknown>;
}) {
  const client = getPostHogClient();
  client.capture({
    distinctId: args.distinctId,
    event: args.event,
    properties: args.properties,
    ...(args.setProperties ? { $set: args.setProperties } : {}),
  });
  try {
    await client.flush();
  } catch {
    // Never let analytics break the request.
  }
}

// Identify + set person properties from the server. Use after auth or when
// subscription state changes so PostHog person profiles stay in sync.
export async function identifyServer(args: {
  distinctId: string;
  set?: Record<string, unknown>;
}) {
  const client = getPostHogClient();
  client.identify({
    distinctId: args.distinctId,
    properties: args.set,
  });
  try {
    await client.flush();
  } catch {
    // swallow
  }
}
