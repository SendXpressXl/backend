-- Per-user like tracking for posts, with an atomic toggle. Supports issue
-- #37. Run this in the Supabase SQL editor alongside the existing schema
-- described in the README.
--
-- This replaces the old increment_likes() RPC, which only ever counted up
-- and kept no record of who liked what. increment_likes() can be dropped
-- once this migration is applied and the deploy using it has rolled out —
-- not doing that here since it's still live until then.

alter table posts
  add column if not exists likes_count integer not null default 0;

create table if not exists post_likes (
  post_id    uuid not null references posts(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_likes_user_id_idx on post_likes(user_id);

-- Atomically toggles a like: removes the row if it exists (unlike),
-- inserts it if it doesn't (like), and keeps posts.likes_count in sync in
-- the same call so there's no separate read-modify-write step for a client
-- to race against.
create or replace function toggle_post_like(p_post_id uuid, p_user_id uuid)
returns table (liked boolean, likes_count int)
language plpgsql
as $$
declare
  v_deleted boolean;
  v_inserted int;
begin
  delete from post_likes
    where post_id = p_post_id and user_id = p_user_id
    returning true into v_deleted;

  if v_deleted then
    update posts set likes_count = likes_count - 1 where id = p_post_id;
  else
    insert into post_likes (post_id, user_id) values (p_post_id, p_user_id)
      on conflict (post_id, user_id) do nothing;
    get diagnostics v_inserted = row_count;

    -- Only increment if this call's insert actually landed. Two concurrent
    -- toggles that both miss the delete can both reach here; the primary
    -- key lets only one insert through, so only that one should count.
    if v_inserted > 0 then
      update posts set likes_count = likes_count + 1 where id = p_post_id;
    end if;
  end if;

  return query
    select not coalesce(v_deleted, false), p.likes_count
    from posts p where p.id = p_post_id;
end;
$$;
