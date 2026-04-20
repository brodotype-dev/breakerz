-- Enable RLS on all public-facing tables.
-- Writes go through supabaseAdmin (service role) in server-side API routes — no anon writes needed.
-- profiles, user_roles, user_breaks already have RLS enabled from earlier migrations.

-- ── Public catalog tables (consumer break pages read via anon key) ─────────────

ALTER TABLE sports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sports: public read"
  ON sports FOR SELECT USING (true);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products: public read"
  ON products FOR SELECT USING (true);

ALTER TABLE players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "players: public read"
  ON players FOR SELECT USING (true);

ALTER TABLE player_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "player_products: public read"
  ON player_products FOR SELECT USING (true);

ALTER TABLE player_product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "player_product_variants: public read"
  ON player_product_variants FOR SELECT USING (true);

ALTER TABLE pricing_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pricing_cache: public read"
  ON pricing_cache FOR SELECT USING (true);

ALTER TABLE player_risk_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "player_risk_flags: public read active"
  ON player_risk_flags FOR SELECT USING (cleared_at IS NULL);

-- ── Waitlist: anon insert only (public signup form) ───────────────────────────

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "waitlist: public insert"
  ON waitlist FOR INSERT WITH CHECK (true);
-- No anon SELECT/UPDATE/DELETE — admin reads via service role only
