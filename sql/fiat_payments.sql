-- Tracks fiat on-ramp payment sessions for deals.
-- Run this in the Supabase SQL editor before using the fiat payment endpoints.

CREATE TABLE IF NOT EXISTS fiat_payments (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id             UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL DEFAULT 'transak',
  provider_session_id TEXT,
  provider_tx_id      TEXT,
  amount_fiat         NUMERIC NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'USD',
  amount_usdc         NUMERIC,
  status              TEXT NOT NULL DEFAULT 'pending',
  wallet              TEXT NOT NULL,
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fiat_payments_deal_id ON fiat_payments(deal_id);
CREATE INDEX IF NOT EXISTS idx_fiat_payments_provider_session ON fiat_payments(provider_session_id);
CREATE INDEX IF NOT EXISTS idx_fiat_payments_status ON fiat_payments(status);

-- Add payment_method column to deals table to distinguish crypto vs fiat funded deals.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deals' AND column_name = 'payment_method'
  ) THEN
    ALTER TABLE deals ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'crypto';
  END IF;
END $$;
