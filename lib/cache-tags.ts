/**
 * Cache tags for `unstable_cache` / `revalidateTag`.
 *
 * Kept out of any `page.tsx` on purpose: Next.js restricts page modules to a
 * known set of exports (default, metadata, revalidate, dynamic, …), so a stray
 * `export const` there is a type error.
 */

/** The active-product grid on Research. Bust when a product's shape changes. */
export const ACTIVE_PRODUCTS_TAG = 'active-products';
