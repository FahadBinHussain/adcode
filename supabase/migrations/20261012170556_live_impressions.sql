-- Preserve website contributions after the 90-day raw-event retention window.
-- Session keys are anonymous browser UUIDs; no account or visitor details are retained.
-- Backfill and trigger installation use one snapshot, without missed events.
lock table public.website_events in share row exclusive mode;

create table public.website_impression_sessions (
  session uuid primary key
);
create table public.website_impression_totals (
  id integer primary key check (id = 1),
  views bigint not null default 0 check (views >= 0),
  sessions bigint not null default 0 check (sessions >= 0)
);
alter table public.website_impression_sessions enable row level security;
alter table public.website_impression_totals enable row level security;
revoke all on public.website_impression_sessions, public.website_impression_totals from public, anon, authenticated;
grant select, insert on public.website_impression_sessions to service_role;
grant select, update on public.website_impression_totals to service_role;

insert into public.website_impression_sessions (session)
select distinct session from public.website_events;
insert into public.website_impression_totals (id, views, sessions)
select 1,
  (select count(*) from public.website_events where name = 'page_view'),
  (select count(*) from public.website_impression_sessions);

-- One update per accepted batch. Duplicate event IDs and updated Web Vitals never add
-- views; the session primary key counts simultaneous events for one session only once.
create function public.record_website_impressions() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  with new_sessions as (
    insert into public.website_impression_sessions (session)
    select distinct session from inserted_events
    on conflict do nothing
    returning session
  )
  update public.website_impression_totals
  set views = views + (select count(*) from inserted_events where name = 'page_view'),
      sessions = sessions + (select count(*) from new_sessions)
  where id = 1;
  return null;
end;
$$;
revoke all on function public.record_website_impressions() from public, anon, authenticated;
grant execute on function public.record_website_impressions() to service_role;
create trigger website_impressions_insert
after insert on public.website_events
referencing new table as inserted_events
for each statement execute function public.record_website_impressions();

-- Composite activity, separate from verified, billable ad views. Only the total leaves
-- the database, as text so bigint JSON serialization cannot round it.
-- One composite impression represents 20 activity units, matching liveImpressions.ts.
create function public.live_impressions() returns text
language sql stable security invoker set search_path = '' as $$
  select floor((
    (select count(*) from public.users)
    + (select count(*) from (
        select uid from public.serves where not test
        union select uid from public.activity_daily
        union select uid from public.milestones
      ) as seen_users)
    + (select count(*) from public.serves where not test)
    + (select coalesce(sum(agent_chars::bigint + accepted_edits + sessions), 0) from public.activity_daily)
    + (select coalesce(sum(input_tokens + output_tokens), 0) from public.tagflow_usage)
    + (select views + sessions from public.website_impression_totals where id = 1)
  ) / 20)::text;
$$;
revoke all on function public.live_impressions() from public, anon, authenticated;
grant execute on function public.live_impressions() to service_role;
