-- A purchase receipt must remain an immutable record of the delivery details
-- and merchant checkout that were approved. The application encrypts this
-- payload before it reaches the database; these fields never contain raw PII.
alter table public.purchases
  add column if not exists invoice_ciphertext text,
  add column if not exists invoice_iv text,
  add column if not exists invoice_auth_tag text;
