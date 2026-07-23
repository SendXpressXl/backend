-- Supports issue #35: storing the confirmed ledger number alongside each
-- escrow transaction hash. Run this in the Supabase SQL editor.

alter table deals
  add column if not exists tx_ledger      integer,
  add column if not exists release_ledger integer,
  add column if not exists refund_ledger  integer;
