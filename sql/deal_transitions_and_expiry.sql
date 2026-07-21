-- Supports the deal state machine, transition logging, and expiry work in
-- issue #34. Run this in the Supabase SQL editor alongside the existing
-- schema described in the README.

alter table deals
  add column if not exists shipped_at timestamptz;

create table if not exists deal_transitions (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references deals(id),
  actor_wallet text not null,
  from_status  text not null,
  to_status    text not null,
  reason       text,
  created_at   timestamptz not null default now()
);

create index if not exists deal_transitions_deal_id_idx on deal_transitions(deal_id);
