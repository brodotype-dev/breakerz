-- Product release date: used to show a pre-release banner on the break page
-- when the product hasn't launched yet and pricing is based on historical comps only.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS release_date DATE DEFAULT NULL;
