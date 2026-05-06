'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';

// Identifies the current user with posthog-js so browser-side pageviews,
// autocaptures, web-vitals, rageclicks etc. are tied to the real user instead
// of an anonymous distinct_id. Server-side identify already runs in
// app/auth/callback/route.ts on first login, but the browser SDK's identity is
// independent — without this component, browser events stay anonymous for the
// rest of the session.
export default function PostHogIdentify({
  userId,
  email,
}: {
  userId: string;
  email: string | null;
}) {
  useEffect(() => {
    if (!userId) return;
    if (posthog.get_distinct_id() === userId) return;
    posthog.identify(userId, email ? { email } : undefined);
  }, [userId, email]);

  return null;
}
