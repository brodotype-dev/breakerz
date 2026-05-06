-- pricing_feedback: row-level thumbs-up / thumbs-down on consumer pricing surfaces.
-- Captures qualitative signal that the pricing or data is wrong on a specific
-- player / team / break / slab analysis. Mirrors the Discord /insight flow but
-- inline on the consumer pages.

CREATE TABLE IF NOT EXISTS public.pricing_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  rating text NOT NULL CHECK (rating IN ('up', 'down')),

  -- Where the thumbs lived. surface = the page-level UI region.
  surface text NOT NULL CHECK (surface IN (
    'player_row',
    'team_row',
    'break_analysis',
    'slab_analysis',
    'pricing_breakdown'
  )),

  -- What the thumbs were attached to. entity_type = the kind of thing,
  -- entity_id = its id (uuid or free-text cert/code).
  entity_type text NOT NULL CHECK (entity_type IN (
    'player_product',
    'team',
    'analysis',
    'cert',
    'variant'
  )),
  entity_id text NOT NULL,

  -- Always available for triage even if entity_type is team/cert.
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,

  -- Optional category + free-text from the popover on a thumbs-down.
  category text CHECK (category IS NULL OR category IN (
    'pricing_too_high',
    'pricing_too_low',
    'wrong_player',
    'missing_data',
    'risk_flag_wrong',
    'other'
  )),
  notes text,

  page_url text,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Admin triage fields.
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note text
);

CREATE INDEX IF NOT EXISTS idx_pricing_feedback_unreviewed
  ON public.pricing_feedback (created_at DESC)
  WHERE reviewed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pricing_feedback_product
  ON public.pricing_feedback (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pricing_feedback_entity
  ON public.pricing_feedback (entity_type, entity_id);

ALTER TABLE public.pricing_feedback ENABLE ROW LEVEL SECURITY;

-- Users can read their own feedback. Admin reads go through the service role.
CREATE POLICY "pricing_feedback_owner_select"
  ON public.pricing_feedback
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Inserts go through the API route which writes via the service role; no anon
-- insert policy needed. Updates (admin triage) also use the service role.
