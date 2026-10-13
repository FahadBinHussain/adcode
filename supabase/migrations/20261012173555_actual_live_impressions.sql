-- Use the unscaled total of accounts, seen users, ad deliveries, accepted edits,
-- editor sessions, website views, and unique website sessions. AI token and generated
-- character volumes are excluded. The existing lifetime website tally is unchanged.
create or replace function public.live_impressions() returns text
language sql stable security invoker set search_path = '' as $$
  select (
    (select count(*) from public.users)
    + (select count(*) from (
        select uid from public.serves where not test
        union select uid from public.activity_daily
        union select uid from public.milestones
      ) as seen_users)
    + (select count(*) from public.serves where not test)
    + (select coalesce(sum(accepted_edits::bigint + sessions), 0) from public.activity_daily)
    + (select views + sessions from public.website_impression_totals where id = 1)
  )::text;
$$;
revoke all on function public.live_impressions() from public, anon, authenticated;
grant execute on function public.live_impressions() to service_role;
