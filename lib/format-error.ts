/**
 * Coerce any error shape to a renderable string.
 *
 * A long-running API route can hit a Vercel PLATFORM error (function
 * timeout / 500) whose JSON body shapes `error` as an OBJECT
 * (`{ code, message, ... }`) rather than the plain string our routes
 * return. Rendering that object directly in JSX throws React error #31
 * ("objects are not valid as a React child") and crashes the page —
 * see PR #160. Admin action buttons must run any error source through
 * this before putting it in component state / JSX.
 */
export function errText(e: unknown, fallback: string): string {
  if (typeof e === 'string' && e.trim()) return e;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) return o.message;
    if (typeof o.error === 'string' && o.error.trim()) return o.error;
    if (typeof o.code === 'string' && o.code.trim()) return o.code;
    try {
      return JSON.stringify(e);
    } catch {
      /* fall through to fallback */
    }
  }
  return fallback;
}
