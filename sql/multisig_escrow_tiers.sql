-- Multi-sig escrow for high-value deals (Issue #50)
-- Adds deal_tier and escrow_destination to deals, plus vote tracking table for multi-sig dispute resolution.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS deal_tier TEXT DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS escrow_destination TEXT;

CREATE TABLE IF NOT EXISTS deal_dispute_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  signer TEXT NOT NULL,
  role TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('release_seller', 'refund_buyer')),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deal_id, signer)
);

CREATE INDEX IF NOT EXISTS idx_deal_dispute_votes_deal_id ON deal_dispute_votes(deal_id);
