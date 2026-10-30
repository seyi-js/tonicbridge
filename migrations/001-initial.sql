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

CREATE TABLE ledger_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('wallet','funding','fx')),
  wallet_id UUID REFERENCES wallets(id),
  currency TEXT NOT NULL CHECK (currency IN ('cNGN','cGHS','cXAF','USDx','EURx')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((kind='wallet') = (wallet_id IS NOT NULL)),
  UNIQUE (id, currency),
  FOREIGN KEY (wallet_id, currency) REFERENCES balances(wallet_id, currency)
);

CREATE UNIQUE INDEX ledger_wallet_account ON ledger_accounts(wallet_id, currency) WHERE kind='wallet';

CREATE UNIQUE INDEX ledger_system_account ON ledger_accounts(kind, currency) WHERE wallet_id IS NULL;

CREATE TABLE ledger_journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL UNIQUE REFERENCES transactions(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  posting_xid xid8 NOT NULL DEFAULT pg_current_xact_id()
);

CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id UUID NOT NULL REFERENCES ledger_journals(id),
  line_number SMALLINT NOT NULL CHECK (line_number BETWEEN 1 AND 4),
  account_id UUID NOT NULL,
  currency TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount NUMERIC(24,6) NOT NULL CHECK (amount > 0 AND amount <= 999999999999999999.999999),
  UNIQUE (journal_id, line_number),
  FOREIGN KEY (account_id, currency) REFERENCES ledger_accounts(id, currency)
);

CREATE INDEX ledger_entries_account ON ledger_entries(account_id);

-- Wallet accounts are liabilities: credits increase the customer's available balance.
-- Funding is a simulated asset; FX clearing records the position in each separate currency.
CREATE FUNCTION expected_ledger_entries(transaction_uuid UUID)
RETURNS TABLE (line_number SMALLINT, kind TEXT, wallet_id UUID, currency TEXT, direction TEXT, amount NUMERIC)
LANGUAGE SQL STABLE AS $$
  SELECT 1::smallint, CASE WHEN t.type='deposit' THEN 'funding' ELSE 'wallet' END,
    t.source_wallet_id, t.source_currency, 'debit', t.source_amount
  FROM transactions t WHERE t.id=transaction_uuid
  UNION ALL
  SELECT 2::smallint, CASE WHEN t.source_currency=t.destination_currency THEN 'wallet' ELSE 'fx' END,
    CASE WHEN t.source_currency=t.destination_currency THEN t.destination_wallet_id ELSE NULL END,
    t.source_currency, 'credit', t.source_amount
  FROM transactions t WHERE t.id=transaction_uuid
  UNION ALL
  SELECT 3::smallint, 'fx', NULL::uuid, t.destination_currency, 'debit', t.destination_amount
  FROM transactions t WHERE t.id=transaction_uuid AND t.source_currency<>t.destination_currency
  UNION ALL
  SELECT 4::smallint, 'wallet', t.destination_wallet_id, t.destination_currency, 'credit', t.destination_amount
  FROM transactions t WHERE t.id=transaction_uuid AND t.source_currency<>t.destination_currency;
$$;

INSERT INTO ledger_accounts(kind,currency)
SELECT kind,currency FROM unnest(ARRAY['funding','fx']) AS kind
CROSS JOIN unnest(ARRAY['cNGN','cGHS','cXAF','USDx','EURx']) AS currency;

CREATE VIEW ledger_reconciliation AS
SELECT b.wallet_id,b.currency,b.amount AS stored_balance,
  coalesce(sum(CASE WHEN e.direction='credit' THEN e.amount ELSE -e.amount END),0) AS ledger_balance,
  a.id IS NOT NULL AND b.amount=coalesce(sum(CASE WHEN e.direction='credit' THEN e.amount ELSE -e.amount END),0) AS matches
FROM balances b
LEFT JOIN ledger_accounts a ON a.wallet_id=b.wallet_id AND a.currency=b.currency AND a.kind='wallet'
LEFT JOIN ledger_entries e ON e.account_id=a.id
GROUP BY b.wallet_id,b.currency,b.amount,a.id;

CREATE VIEW ledger_journal_totals AS
SELECT journal_id,currency,
  sum(CASE WHEN direction='debit' THEN amount ELSE 0 END) AS debits,
  sum(CASE WHEN direction='credit' THEN amount ELSE 0 END) AS credits
FROM ledger_entries GROUP BY journal_id,currency;

CREATE FUNCTION assert_ledger_journal(journal_uuid UUID) RETURNS void LANGUAGE plpgsql AS $$
DECLARE transaction_uuid UUID;
BEGIN
  SELECT transaction_id INTO STRICT transaction_uuid FROM ledger_journals WHERE id=journal_uuid;

  IF NOT EXISTS (SELECT 1 FROM ledger_entries WHERE journal_id=journal_uuid)
    OR EXISTS (SELECT 1 FROM ledger_journal_totals WHERE journal_id=journal_uuid AND debits<>credits) THEN
    RAISE EXCEPTION 'Journal must contain equal debits and credits in each currency'
      USING ERRCODE='23514', CONSTRAINT='ledger_journal_balanced';
  END IF;

  -- A balanced journal must also describe the exact transaction it belongs to.
  IF EXISTS (
    WITH expected AS (SELECT * FROM expected_ledger_entries(transaction_uuid)),
    actual AS (
      SELECT e.line_number,a.kind,a.wallet_id,e.currency,e.direction,e.amount
      FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id WHERE e.journal_id=journal_uuid
    )
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  ) THEN
    RAISE EXCEPTION 'Journal entries do not match their transaction'
      USING ERRCODE='23514', CONSTRAINT='ledger_journal_matches_transaction';
  END IF;
END;
$$;

CREATE FUNCTION reject_financial_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; financial corrections require a new journal', TG_TABLE_NAME
    USING ERRCODE='23514', CONSTRAINT='ledger_append_only';
END;
$$;

CREATE TRIGGER ledger_accounts_immutable
BEFORE UPDATE OR DELETE ON ledger_accounts
FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();

CREATE TRIGGER ledger_journals_immutable
BEFORE UPDATE OR DELETE ON ledger_journals
FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();

CREATE TRIGGER ledger_entries_immutable
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();

CREATE TRIGGER transactions_immutable
BEFORE UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();

CREATE TRIGGER ledger_accounts_no_truncate
BEFORE TRUNCATE ON ledger_accounts
FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_mutation();

CREATE TRIGGER ledger_journals_no_truncate
BEFORE TRUNCATE ON ledger_journals
FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_mutation();

CREATE TRIGGER ledger_entries_no_truncate
BEFORE TRUNCATE ON ledger_entries
FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_mutation();

CREATE TRIGGER transactions_no_truncate
BEFORE TRUNCATE ON transactions
FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_mutation();

CREATE FUNCTION stamp_ledger_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.posting_xid := pg_current_xact_id();

  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_journal_stamp
BEFORE INSERT ON ledger_journals
FOR EACH ROW EXECUTE FUNCTION stamp_ledger_journal();

CREATE FUNCTION guard_ledger_entry_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ledger_journals WHERE id=NEW.journal_id AND posting_xid=pg_current_xact_id()) THEN
    RAISE EXCEPTION 'A committed journal cannot accept new entries'
      USING ERRCODE='23514', CONSTRAINT='ledger_journal_sealed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_entry_insert
BEFORE INSERT ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION guard_ledger_entry_insert();

CREATE FUNCTION check_ledger_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='ledger_journals' THEN
    PERFORM assert_ledger_journal(NEW.id);
  ELSE
    PERFORM assert_ledger_journal(NEW.journal_id);
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_journal_complete
AFTER INSERT ON ledger_journals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_ledger_journal();

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_ledger_journal();

CREATE FUNCTION require_transaction_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ledger_journals WHERE transaction_id=NEW.id) THEN
    RAISE EXCEPTION 'Every transaction requires a ledger journal'
      USING ERRCODE='23514', CONSTRAINT='transaction_requires_journal';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER transaction_has_journal
AFTER INSERT ON transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_transaction_journal();

CREATE FUNCTION check_wallet_ledger_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wallet_uuid UUID; asset TEXT;
BEGIN
  IF TG_TABLE_NAME='ledger_entries' THEN
    SELECT wallet_id,currency INTO wallet_uuid,asset FROM ledger_accounts WHERE id=NEW.account_id;

    IF wallet_uuid IS NULL THEN
      RETURN NULL;
    END IF;
  ELSE
    wallet_uuid := NEW.wallet_id;
    asset := NEW.currency;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ledger_reconciliation WHERE wallet_id=wallet_uuid AND currency=asset AND matches) THEN
    RAISE EXCEPTION 'Wallet balance must match its ledger entries'
      USING ERRCODE='23514', CONSTRAINT='wallet_balance_matches_ledger';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER wallet_balance_reconciled
AFTER INSERT OR UPDATE ON balances
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_wallet_ledger_balance();

CREATE CONSTRAINT TRIGGER ledger_wallet_reconciled
AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_wallet_ledger_balance();
