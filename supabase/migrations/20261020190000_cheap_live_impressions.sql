-- The landing page's live counter polls `live_impressions()` every few seconds per visitor, and
-- each call counted every user, de-duplicated user ids across three tables and counted every ad
-- serve: ~150 ms and ~12,000 buffers on 2026-10-20, growing with every user. It now recomputes
-- at most once a minute and otherwise reads one stored row. The figure was already a rounded
-- "live" total; a minute of lag is invisible on it.
begin;

create table if not exists public.live_impressions_cache (
  id integer primary key check (id = 1),
  total bigint not null,
  computed_at timestamptz not null
);
alter table public.live_impressions_cache enable row level security;
revoke all on public.live_impressions_cache from anon, authenticated;
grant all on public.live_impressions_cache to service_role;

-- The original count, unchanged, under its own name.
create or replace function public.live_impressions_compute() returns bigint
language sql stable security invoker set search_path = '' as $$
  select
    (select count(*) from public.users)
    + (select count(*) from (
        select uid from public.serves where not test
        union select uid from public.activity_daily
        union select uid from public.milestones
      ) as seen_users)
    + (select count(*) from public.serves where not test)
    + (select coalesce(sum(accepted_edits::bigint + sessions), 0) from public.activity_daily)
    + (select views + sessions from public.website_impression_totals where id = 1);
$$;

-- Same name and return type as before, so the API calls it unchanged.
create or replace function public.live_impressions() returns text
language plpgsql volatile security invoker set search_path = '' as $$
declare
  cached public.live_impressions_cache%rowtype;
  fresh bigint;
begin
  select * into cached from public.live_impressions_cache where id = 1;
  if found and cached.computed_at > now() - interval '60 seconds' then
    return cached.total::text;
  end if;
  -- One caller recomputes; the rest answer with the stored figure rather than queueing.
  if not pg_try_advisory_xact_lock(hashtext('live_impressions')) then
    return coalesce(cached.total, public.live_impressions_compute())::text;
  end if;
  fresh := public.live_impressions_compute();
  insert into public.live_impressions_cache (id, total, computed_at) values (1, fresh, now())
    on conflict (id) do update set total = excluded.total, computed_at = excluded.computed_at;
  return fresh::text;
end
$$;

revoke all on function public.live_impressions_compute() from public, anon, authenticated;
revoke all on function public.live_impressions() from public, anon, authenticated;
grant execute on function public.live_impressions_compute() to service_role;
grant execute on function public.live_impressions() to service_role;

-- The performance advisor's unindexed foreign keys (advertiser credit tables).
create index if not exists advertiser_credit_entries_advertiser_idx on public.advertiser_credit_entries (advertiser_id);
create index if not exists advertiser_credit_entries_order_idx on public.advertiser_credit_entries (order_id);
create index if not exists advertiser_credit_orders_advertiser_idx on public.advertiser_credit_orders (advertiser_id);

commit;
