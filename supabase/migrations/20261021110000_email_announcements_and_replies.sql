-- Three more kinds of ADCode email, on the same sender, suppressions, daily budget and webhook as
-- the return campaign (20261016011604), but in tables of their own so that reviewed campaign's
-- rules are not touched:
--
--   * announcements - a new release or docs, to people who already said yes to "ADCode updates
--     and project ideas" (email_preferences.subscribed, consent version product-updates-v1);
--   * status updates - a status-page incident and its resolution, to people who separately ticked
--     "email me about outages" (the new email_preferences.status_updates);
--   * report replies - an administrator's answer to a bug report, to the person who filed it.
--
-- Announcements and status updates go out only while email_settings is enabled with a postal
-- address, exactly like the return campaign. A report reply is a direct answer to someone who
-- wrote in, so it does not wait for that switch - but it still honours every suppression.
begin;

alter table public.email_preferences
  add column if not exists status_updates boolean not null default false,
  add column if not exists status_consent_at bigint;

create table if not exists public.email_announcements (
  id uuid primary key default gen_random_uuid(),
  topic text not null check (topic in ('product','status')),
  ref text not null check (length(ref) between 1 and 200),
  subject text not null check (length(subject) between 1 and 200),
  payload jsonb not null,
  created_by text not null,
  created_at bigint not null,
  unique (topic, ref)
);

create table if not exists public.email_announcement_jobs (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.email_announcements(id) on delete cascade,
  uid text not null references public.users(uid) on delete cascade,
  email text not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','cancelled','failed')),
  due_at bigint not null default 0,
  attempts integer not null default 0,
  first_attempt_at bigint,
  lease_until bigint,
  provider_id text,
  sent_at bigint,
  delivered_at bigint,
  last_error text,
  unique (announcement_id, email)
);
create index if not exists email_announcement_jobs_due_idx on public.email_announcement_jobs(due_at) where status in ('pending','sending');
create index if not exists email_announcement_jobs_provider_idx on public.email_announcement_jobs(provider_id) where provider_id is not null;
create index if not exists email_announcement_jobs_uid_idx on public.email_announcement_jobs(uid);

create table if not exists public.report_replies (
  reply_id uuid primary key,
  report_id text not null references public.reports(report_id) on delete cascade,
  author_uid text not null,
  email text not null,
  body text not null check (length(body) between 1 and 5000),
  provider_id text,
  created_at bigint not null,
  delivered_at bigint
);
create index if not exists report_replies_report_idx on public.report_replies(report_id);
create index if not exists report_replies_provider_idx on public.report_replies(provider_id) where provider_id is not null;

alter table public.email_announcements enable row level security;
alter table public.email_announcements force row level security;
alter table public.email_announcement_jobs enable row level security;
alter table public.email_announcement_jobs force row level security;
alter table public.report_replies enable row level security;
alter table public.report_replies force row level security;
revoke all on public.email_announcements, public.email_announcement_jobs, public.report_replies from public, anon, authenticated;
grant all on public.email_announcements, public.email_announcement_jobs, public.report_replies to service_role;

-- Status updates are their own yes. Ticking it is a conscious choice, so it undoes an ordinary
-- unsubscribe (never a bounce or complaint), as ticking the return campaign's box does. The return
-- campaign's own consent is left exactly as it was.
create or replace function public.email_set_status_updates(p_uid text, p_enabled boolean, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_email text;
begin
  select lower(email) into v_email from public.users
    where uid=p_uid and status='active' and email_verified=true and email is not null;
  if v_email is null then raise exception 'verified-email-required'; end if;
  if p_enabled then
    delete from public.email_suppressions where email=v_email and reason='unsubscribe';
  end if;
  insert into public.email_preferences(uid,email,subscribed,consent_at,consent_version,last_active_at,status_updates,status_consent_at)
    values(p_uid,v_email,false,null,'product-updates-v1',p_now,p_enabled,case when p_enabled then p_now else null end)
    on conflict(uid) do update set
      -- A changed address carries none of the old address's consent.
      subscribed=case when email_preferences.email<>excluded.email then false else email_preferences.subscribed end,
      email=excluded.email,
      status_updates=excluded.status_updates,
      status_consent_at=case
        when not excluded.status_updates then null
        when not email_preferences.status_updates or email_preferences.email<>excluded.email then p_now
        else email_preferences.status_consent_at end;
  if not p_enabled then
    update public.email_announcement_jobs j set status='cancelled',lease_until=null
      from public.email_announcements a
      where a.id=j.announcement_id and a.topic='status' and j.uid=p_uid and j.status in ('pending','sending');
  end if;
end $$;

-- Queues one announcement for everyone who asked for its topic. Idempotent per topic and ref:
-- announcing the same release or incident update twice queues nothing the second time (-1).
create or replace function public.email_announce(p_topic text, p_ref text, p_subject text, p_payload jsonb, p_by text, p_now bigint)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_count integer;
begin
  insert into public.email_announcements(topic,ref,subject,payload,created_by,created_at)
    values(p_topic,p_ref,p_subject,p_payload,p_by,p_now)
    on conflict(topic,ref) do nothing returning id into v_id;
  if v_id is null then return -1; end if;
  insert into public.email_announcement_jobs(announcement_id,uid,email,due_at)
    select v_id,p.uid,p.email,p_now
    from public.email_preferences p join public.users u on u.uid=p.uid
    where case when p_topic='product' then p.subscribed and p.consent_at is not null
               else p.status_updates and p.status_consent_at is not null end
      and u.status='active' and u.email_verified and lower(u.email)=p.email
      and not exists(select 1 from public.email_suppressions s where s.email=p.email)
    on conflict(announcement_id,email) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Claims due announcement mail. The same advisory lock and the same daily budget as the return
-- campaign: every kind of bulk ADCode email together stays under one ceiling.
create or replace function public.email_claim_announcements(p_now bigint, p_limit integer default 10)
returns table(id uuid, uid text, email text, attempts integer, topic text, subject text, payload jsonb, unsubscribe_token uuid)
language plpgsql security invoker set search_path = '' as $$
declare v_day date := (to_timestamp(p_now/1000.0) at time zone 'UTC')::date;
  v_count integer; v_limit integer;
begin
  perform pg_advisory_xact_lock(726314811);
  if not exists(select 1 from public.email_settings where enabled and length(trim(postal_address))>=10) then return; end if;
  insert into public.email_daily_budget(day) values(v_day) on conflict do nothing;
  select claimed into v_count from public.email_daily_budget where day=v_day for update;
  v_limit := least(greatest(p_limit,0),10,greatest(50-v_count,0));
  update public.email_announcement_jobs j set status='failed',last_error='retry-window-expired'
    where j.status in ('pending','sending') and j.first_attempt_at is not null and j.first_attempt_at<p_now-82800000;
  return query
    with candidates as (
      select j.id from public.email_announcement_jobs j
      join public.email_announcements a on a.id=j.announcement_id
      join public.email_preferences p on p.uid=j.uid join public.users u on u.uid=j.uid
      where j.due_at<=p_now and j.attempts<5
        and (j.status='pending' or (j.status='sending' and j.lease_until<p_now))
        and case when a.topic='product' then p.subscribed and p.consent_at is not null
                 else p.status_updates and p.status_consent_at is not null end
        and p.email=j.email and lower(u.email)=j.email and u.email_verified and u.status='active'
        and not exists(select 1 from public.email_suppressions s where s.email=j.email)
      order by a.created_at, j.id for update of j skip locked limit v_limit
    ), claimed as (
      update public.email_announcement_jobs j set status='sending',attempts=j.attempts+1,
        first_attempt_at=coalesce(j.first_attempt_at,p_now),lease_until=p_now+600000
        from candidates c where j.id=c.id returning j.*
    )
    select c.id,c.uid,c.email,c.attempts,a.topic,a.subject,a.payload,p.unsubscribe_token
    from claimed c join public.email_announcements a on a.id=c.announcement_id
    join public.email_preferences p on p.uid=c.uid;
  get diagnostics v_count = row_count;
  update public.email_daily_budget set claimed=claimed+v_count where day=v_day;
end $$;

-- Records a claimed announcement's outcome. An accepted send keeps its provider id even if the
-- person unsubscribed meanwhile, so a later bounce can still suppress the address.
create or replace function public.email_finish_announcement(p_id uuid, p_provider_id text, p_retry boolean, p_code text, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_provider_id is not null then
    update public.email_announcement_jobs set status='sent',provider_id=p_provider_id,sent_at=p_now,lease_until=null,last_error=null where id=p_id;
    perform public.email_reconcile(p_provider_id);
  else
    update public.email_announcement_jobs set
      status=case when p_retry and attempts<5 then 'pending' else 'failed' end,
      lease_until=null, last_error=p_code, due_at=p_now+least(21600000, 60000*(2^attempts)::bigint)
      where id=p_id and status='sending';
  end if;
end $$;

-- The status email's own unsubscribe: it stops status updates and nothing else.
create or replace function public.email_unsubscribe_status(p_token uuid, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_uid text;
begin
  update public.email_preferences set status_updates=false,status_consent_at=null
    where unsubscribe_token=p_token returning uid into v_uid;
  if v_uid is null then return; end if;
  update public.email_announcement_jobs j set status='cancelled',lease_until=null
    from public.email_announcements a
    where a.id=j.announcement_id and a.topic='status' and j.uid=v_uid and j.status in ('pending','sending');
end $$;

-- The global unsubscribe (the link in every announcement and campaign email) now also stops
-- queued announcements and status updates, not only the return campaign.
create or replace function public.email_unsubscribe(p_token uuid, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_email text;
begin
  select email into v_email from public.email_preferences where unsubscribe_token=p_token;
  if v_email is null then return; end if;
  insert into public.email_suppressions values(v_email,'unsubscribe',p_now)
    on conflict(email) do nothing;
  update public.email_preferences set subscribed=false,status_updates=false,status_consent_at=null where email=v_email;
  update public.email_jobs set status='cancelled',lease_until=null
    where email=v_email and status in ('pending','sending');
  update public.email_announcement_jobs set status='cancelled',lease_until=null
    where email=v_email and status in ('pending','sending');
end $$;

-- Webhook events now find their email whichever kind of send it was. A bounce or complaint
-- suppresses the address for every kind of ADCode email, as before.
create or replace function public.email_apply_event(p_id text,p_type text,p_provider_id text,p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_email text; v_reason text;
begin
  insert into public.email_webhook_events(id,received_at,provider_id,kind)
    values(p_id,p_now,p_provider_id,p_type) on conflict do nothing;
  if exists(select 1 from public.email_webhook_events where id=p_id and processed) then return; end if;
  v_email := coalesce(
    (select email from public.email_jobs where provider_id=p_provider_id limit 1),
    (select email from public.email_announcement_jobs where provider_id=p_provider_id limit 1),
    (select email from public.report_replies where provider_id=p_provider_id limit 1));
  if v_email is null then return; end if;
  if p_type='email.delivered' then
    update public.email_jobs set delivered_at=p_now where provider_id=p_provider_id;
    update public.email_announcement_jobs set delivered_at=p_now where provider_id=p_provider_id;
    update public.report_replies set delivered_at=p_now where provider_id=p_provider_id;
  elsif p_type in ('email.bounced','email.complained') then
    v_reason := case when p_type='email.complained' then 'complaint' else 'bounce' end;
    insert into public.email_suppressions values(v_email,v_reason,p_now)
      on conflict(email) do update set reason=excluded.reason;
    update public.email_preferences set subscribed=false,status_updates=false,status_consent_at=null where email=v_email;
    update public.email_jobs set status='cancelled',lease_until=null
      where email=v_email and status in ('pending','sending');
    update public.email_announcement_jobs set status='cancelled',lease_until=null
      where email=v_email and status in ('pending','sending');
  end if;
  update public.email_webhook_events set processed=true where id=p_id;
end $$;

revoke execute on function public.email_set_status_updates(text,boolean,bigint),
  public.email_announce(text,text,text,jsonb,text,bigint),
  public.email_claim_announcements(bigint,integer),
  public.email_finish_announcement(uuid,text,boolean,text,bigint),
  public.email_unsubscribe_status(uuid,bigint),
  public.email_unsubscribe(uuid,bigint),
  public.email_apply_event(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.email_set_status_updates(text,boolean,bigint),
  public.email_announce(text,text,text,jsonb,text,bigint),
  public.email_claim_announcements(bigint,integer),
  public.email_finish_announcement(uuid,text,boolean,text,bigint),
  public.email_unsubscribe_status(uuid,bigint),
  public.email_unsubscribe(uuid,bigint),
  public.email_apply_event(text,text,text,bigint) to service_role;

commit;
