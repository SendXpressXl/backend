-- Cross-chain deposits table for Circle CCTP integration
-- Tracks USDC burns on EVM chains and their attestation/lock status on Stellar

CREATE TABLE IF NOT EXISTS cross_chain_deposits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         uuid NOT NULL REFERENCES deals(id),
  buyer_wallet    varchar(56) NOT NULL,
  burn_tx_hash    varchar(66) NOT NULL,
  source_chain    varchar(20) NOT NULL,
  source_domain   integer NOT NULL,
  amount          numeric(20, 7) NOT NULL,
  status          varchar(20) NOT NULL DEFAULT 'pending',
  attestation     text,
  cctp_message    text,
  stellar_tx_hash varchar(64),
  stellar_ledger  integer,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Index for looking up deposits by deal
CREATE INDEX IF NOT EXISTS idx_cross_chain_deposits_deal_id
  ON cross_chain_deposits(deal_id);

-- Index for looking up deposits by buyer wallet
CREATE INDEX IF NOT EXISTS idx_cross_chain_deposits_buyer_wallet
  ON cross_chain_deposits(buyer_wallet);

-- Index for polling pending/attesting deposits
CREATE INDEX IF NOT EXISTS idx_cross_chain_deposits_status
  ON cross_chain_deposits(status)
  WHERE status IN ('pending', 'attesting');

-- Auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_cross_chain_deposits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cross_chain_deposits_updated_at
  BEFORE UPDATE ON cross_chain_deposits
  FOR EACH ROW
  EXECUTE FUNCTION update_cross_chain_deposits_updated_at();

-- Add payment_method column to deals table if it doesn't exist
ALTER TABLE deals ADD COLUMN IF NOT EXISTS payment_method varchar(20) DEFAULT 'xlm';
