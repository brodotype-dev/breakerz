-- Separate display name from CardHedger canonical set name
-- ch_set_name: exact string passed to /v1/cards/card-search ?set= and set-catalog mode
-- name: display name shown to consumers (can be shorter/cleaner)
ALTER TABLE products
  ADD COLUMN ch_set_name TEXT;
