-- Supports issue #51: milestone-based installment payments for large orders.
-- Run this in the Supabase SQL editor.

-- Flag existing deals as milestone-aware. New milestone deals get this set to
-- true; legacy deals stay false so the rest of the codebase doesn't need to
-- change.
alter table deals
  add column if not exists is_milestone_deal boolean not null default false;

-- Each row is one installment within a milestone deal. The total of all
-- milestone amounts must equal the parent deal's amount.
create table if not exists deal_milestones (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null references deals(id) on delete cascade,
  sequence        integer not null,
  label           text not null,
  amount          numeric not null,
  asset           text not null default 'native',
  status          text not null default 'pending'
                  check (status in (
                    'pending',     -- waiting for seller to complete this step
                    'shipped',     -- seller marked shipment
                    'confirming',  -- buyer confirming, escrow release in-flight
                    'confirmed',   -- release succeeded, funds sent to seller
                    'disputed'     -- either party flagged a problem
                  )),
  tx_hash         text,
  release_tx      text,
  release_ledger  integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (deal_id, sequence)
);

create index if not exists deal_milestones_deal_id_idx on deal_milestones(deal_id);
