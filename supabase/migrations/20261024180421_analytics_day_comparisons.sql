-- A real timestamped baseline; moving p_now on growth_stats alone includes future rows.
create or replace function public.read_growth_day_baseline(p_at bigint)
returns jsonb language sql stable security invoker set search_path = '' as $$
with seen_all as materialized (
  select x.uid, x.at from public.growth_sightings() x where x.at <= p_at
), spans as (
  select uid, min(at) as first_seen from seen_all group by uid
), seen as (
  select x.*, x.at >= s.first_seen + 86400000 as is_return
  from seen_all x join spans s using(uid) where x.at > p_at - 2592000000
)
select jsonb_build_object(
  'developers', (select count(*) from public.users u join spans s using(uid) where u.status='active' and u.created_at <= p_at),
  'active1d', (select count(distinct uid) from seen where at > p_at - 86400000),
  'active7d', (select count(distinct uid) from seen where at > p_at - 604800000),
  'active30d', (select count(distinct uid) from seen),
  'returning7d', (select count(distinct uid) from seen where is_return and at > p_at - 604800000),
  'adsShown', (select count(*) from public.receipts where cost_micros > 0 and outcome <> 'click' and created_at <= p_at),
  'creditedMicros', (select coalesce(sum(credited_micros),0)::text from public.receipts where cost_micros > 0 and created_at <= p_at),
  'paidOutMicros', case when exists(select 1 from public.withdrawals where status='paid' and decided_at is null) then null
    else (select coalesce(sum(amount_micros),0)::text from public.withdrawals where status='paid' and decided_at <= p_at) end
);
$$;
revoke all on function public.read_growth_day_baseline(bigint) from public, anon, authenticated;
grant execute on function public.read_growth_day_baseline(bigint) to service_role;
