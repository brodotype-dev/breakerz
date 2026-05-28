// Editorial import orchestrator — Slice 3 (Bucket A).
//
// For a product with editorial_urls set, scrapes each URL, extracts
// product/team/player hype + sentiment (parseEditorial), and writes them
// directly to market_observations with per-URL attribution. No Discord
// proposal — the admin who set the URLs is already the gate.
//
// Re-scrape is idempotent-ish: before writing fresh observations for a URL
// we supersede the prior active editorial observations from that same URL,
// so re-running doesn't pile up stale duplicate rows.
//
// Writes ONLY market_observations (matching the shapes in the Discord
// applyUpdates path). Never touches breakerz_score — editorial is its own
// source, kept separate from Track B SME sentiment.

import { supabaseAdmin } from './supabase';
import { scrapeEditorial } from './scrapers/editorial';
import { parseEditorial, type EditorialUpdate } from './editorial-parser';

export interface EditorialUrlResult {
  url: string;
  ok: boolean;
  written: number;
  superseded: number;
  error?: string;
}

export interface EditorialImportSummary {
  productId: string;
  urlCount: number;
  totalWritten: number;
  results: EditorialUrlResult[];
}

// `source_user_id` is NOT NULL on market_observations. Editorial writes have
// no Discord user — tag them with a system marker so analytics can tell
// editorial-sourced rows from human-submitted ones.
const EDITORIAL_SOURCE_USER = 'system:editorial';

function buildObservationRow(u: EditorialUpdate, sourceUrl: string) {
  const decayDays = Math.max(1, (u as { decay_days?: number }).decay_days ?? 30);
  const expiresAt = new Date(Date.now() + decayDays * 86_400_000).toISOString();
  const confidence = (u as { confidence?: number }).confidence ?? null;

  if (u.kind === 'hype_tag') {
    return {
      observation_type: 'hype_tag',
      scope_type: u.scope_type,
      scope_id: u.scope_type === 'player' ? (u.scope_player_id ?? null) : null,
      scope_team: null,
      product_id: u.product_id,
      payload: { tag: u.tag, strength: u.strength, decay_days: u.decay_days },
      source_user_id: EDITORIAL_SOURCE_USER,
      source_narrative: sourceUrl,
      confidence,
      expires_at: expiresAt,
    };
  }

  // product_sentiment / team_sentiment / team_product_sentiment
  const isTeamScoped = u.kind === 'team_sentiment' || u.kind === 'team_product_sentiment';
  const isProductScoped = u.kind === 'product_sentiment' || u.kind === 'team_product_sentiment';
  const payload: Record<string, unknown> = {
    direction: u.direction,
    strength: u.strength,
    decay_days: u.decay_days,
  };
  if (u.tag) payload.tag = u.tag;

  return {
    observation_type: u.kind,
    scope_type: isTeamScoped ? 'team' : 'product',
    scope_id: null,
    scope_team: isTeamScoped ? (u as { team_name: string }).team_name : null,
    product_id: isProductScoped ? (u as { product_id: string }).product_id : null,
    payload,
    source_user_id: EDITORIAL_SOURCE_USER,
    source_narrative: sourceUrl,
    confidence,
    expires_at: expiresAt,
  };
}

export async function refreshProductEditorial(productId: string): Promise<EditorialImportSummary> {
  const { data: product, error: prodErr } = await supabaseAdmin
    .from('products')
    .select('id, name, year, editorial_urls')
    .eq('id', productId)
    .single<{ id: string; name: string; year: number | null; editorial_urls: string[] | null }>();

  if (prodErr || !product) {
    throw new Error(prodErr?.message ?? 'Product not found');
  }

  const urls = (product.editorial_urls ?? []).map(u => u.trim()).filter(Boolean);
  const results: EditorialUrlResult[] = [];
  let totalWritten = 0;

  for (const url of urls) {
    try {
      const page = await scrapeEditorial(url);
      const { updates } = await parseEditorial({
        markdown: page.markdown,
        product: { id: product.id, name: product.name, year: product.year },
        sourceUrl: url,
      });

      // Supersede prior active editorial observations from THIS url so a
      // re-scrape replaces rather than stacks. Editorial rows are tagged
      // with source_user_id = system:editorial and source_narrative = url.
      const nowIso = new Date().toISOString();
      const { data: superseded, error: supErr } = await supabaseAdmin
        .from('market_observations')
        .update({ superseded_at: nowIso })
        .eq('source_user_id', EDITORIAL_SOURCE_USER)
        .eq('source_narrative', url)
        .is('superseded_at', null)
        .select('id');
      if (supErr) throw supErr;

      let written = 0;
      if (updates.length > 0) {
        const rows = updates.map(u => buildObservationRow(u, url));
        const { error: insErr } = await supabaseAdmin.from('market_observations').insert(rows);
        if (insErr) throw insErr;
        written = rows.length;
      }

      totalWritten += written;
      results.push({ url, ok: true, written, superseded: superseded?.length ?? 0 });
    } catch (err) {
      results.push({
        url,
        ok: false,
        written: 0,
        superseded: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { productId, urlCount: urls.length, totalWritten, results };
}
