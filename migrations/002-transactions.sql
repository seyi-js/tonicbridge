CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('deposit','swap','transfer')),
  source_wallet_id UUID REFERENCES wallets(id),
  destination_wallet_id UUID NOT NULL REFERENCES wallets(id),
  source_currency TEXT NOT NULL CHECK (source_currency IN ('cNGN','cGHS','cXAF','USDx','EURx')),
  destination_currency TEXT NOT NULL CHECK (destination_currency IN ('cNGN','cGHS','cXAF','USDx','EURx')),
  source_amount NUMERIC(24,6) NOT NULL CHECK (source_amount > 0 AND source_amount <= 999999999999999999.999999),
  destination_amount NUMERIC(24,6) NOT NULL CHECK (destination_amount > 0 AND destination_amount <= 999999999999999999.999999),
  rate NUMERIC(32,12) NOT NULL CHECK (rate > 0 AND rate < 1e20),
  rate_source TEXT CHECK (rate_source IN ('live','fixed')),
  rate_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (type='deposit' AND source_wallet_id IS NULL AND source_currency=destination_currency)
    OR (type='swap' AND source_wallet_id IS NOT NULL AND source_wallet_id=destination_wallet_id AND source_currency<>destination_currency)
    OR (type='transfer' AND source_wallet_id IS NOT NULL AND source_wallet_id<>destination_wallet_id)
  ),
  CHECK (
    (source_currency=destination_currency AND source_amount=destination_amount AND rate=1 AND rate_source IS NULL AND rate_updated_at IS NULL)
    OR (source_currency<>destination_currency AND rate_source IS NOT NULL AND rate_updated_at IS NOT NULL)
  )
);
CREATE INDEX transactions_sender_history ON transactions(source_wallet_id, created_at DESC, id DESC);
CREATE INDEX transactions_recipient_history ON transactions(destination_wallet_id, created_at DESC, id DESC);

CREATE TABLE idempotency_requests (
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  key TEXT NOT NULL CHECK (key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  fingerprint TEXT NOT NULL,
  transaction_id UUID NOT NULL UNIQUE REFERENCES transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet_id, key)
);
