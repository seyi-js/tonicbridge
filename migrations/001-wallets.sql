CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CHECK (email IS NULL OR email = lower(btrim(email))),
  CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE TABLE balances (
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  currency TEXT NOT NULL CHECK (currency IN ('cNGN','cGHS','cXAF','USDx','EURx')),
  amount NUMERIC(24,6) NOT NULL DEFAULT 0 CHECK (amount >= 0 AND amount <= 999999999999999999.999999),
  PRIMARY KEY (wallet_id, currency)
);
