import ActiveProductsBrowser from '../ActiveProductsBrowser';
import { getActiveProducts } from '@/lib/active-products';
import AnalysisClient from './AnalysisClient';

/**
 * Research — value a spot, then browse what's live.
 *
 * Active Products moved here from the old `/breaks` page (2026-09-15): the
 * product grid belongs next to the tool that values a spot, not on its own
 * destination. `/breaks` was merged into Breaks (`/my-breaks`), which is the
 * historical record of what you analyzed and bought.
 *
 * This file is a SERVER wrapper because the grid needs a richer query than the
 * client's `/api/analysis` products list (7-day break counts + active hype
 * tags). The valuation tool itself stays client-side in AnalysisClient.
 */

// NO `export const revalidate` here, deliberately.
//
// The old /breaks page carried `revalidate = 60` plus a comment claiming the
// render was cached and that admin mutations busted it via revalidatePath('/').
// Both were false, verified 2026-09-15 against the build's prerender manifest:
// this route is absent from it, i.e. DYNAMIC. The consumer layout calls
// getCurrentUserFromSession() -> cookies(), which opts the whole segment into
// dynamic rendering and makes any `revalidate` on the page inert. And no
// revalidatePath('/') exists anywhere in app/admin.
//
// So the page render was never cached — meaning every navigation re-ran the
// three Supabase queries below. That's the cost worth fixing (prod is
// IO-constrained), not a staleness problem: edits already appeared instantly.
//
// Fix: cache the DATA rather than the render, and tag it so admin product
// mutations bust it immediately. Same pattern as lib/pricing-read.ts.
// (The tag lives in lib/cache-tags.ts — page modules may only export a known
// set of names, so declaring it here is a type error.)

export default async function ResearchPage() {
  const { products, signals } = await getActiveProducts();

  return (
    <>
      <AnalysisClient />

      {/* Active products — below the two boxes, per the 2026-09-15 IA change.
          The browser renders its own section header; don't add a second one. */}
      <div className="px-6 pb-12">
        <div className="max-w-7xl mx-auto" style={{ borderTop: '1px solid var(--rule)', paddingTop: 28 }}>
          <ActiveProductsBrowser products={products} signals={signals} />
        </div>
      </div>
    </>
  );
}
