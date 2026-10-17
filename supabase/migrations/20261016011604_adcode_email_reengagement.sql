-- No existing user is opted in. Identity and consent are separate facts.
create table public.email_preferences (
  uid text primary key references public.users(uid) on delete cascade,
  email text not null check (email = lower(email)),
  subscribed boolean not null default false,
  consent_at bigint,
  consent_version text,
  last_active_at bigint not null,
  unsubscribe_token uuid not null default gen_random_uuid() unique
);
create table public.email_suppressions (
  email text primary key,
  reason text not null check (reason in ('unsubscribe','bounce','complaint')),
  created_at bigint not null
);
create table public.email_jobs (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.users(uid) on delete cascade,
  email text not null,
  campaign text not null default 'return-v1',
  step integer not null check (step between 0 and 2),
  started_at bigint not null,
  due_at bigint not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','cancelled','failed')),
  attempts integer not null default 0,
  first_attempt_at bigint,
  lease_until bigint,
  provider_id text,
  sent_at bigint,
  delivered_at bigint,
  returned_at bigint,
  last_error text,
  unique (email, campaign, step)
);
create index email_jobs_due_idx on public.email_jobs(due_at) where status in ('pending','sending');
create index email_jobs_uid_idx on public.email_jobs(uid);
create table public.email_daily_budget (
  day date primary key,
  claimed integer not null default 0
);
create table public.email_webhook_events (
  id text primary key,
  received_at bigint not null,
  provider_id text not null,
  kind text not null,
  processed boolean not null default false
);
create table public.email_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  postal_address text
);
insert into public.email_settings(singleton) values (true);

alter table public.email_preferences enable row level security;
alter table public.email_preferences force row level security;
alter table public.email_suppressions enable row level security;
alter table public.email_suppressions force row level security;
alter table public.email_jobs enable row level security;
alter table public.email_jobs force row level security;
alter table public.email_daily_budget enable row level security;
alter table public.email_daily_budget force row level security;
alter table public.email_webhook_events enable row level security;
alter table public.email_webhook_events force row level security;
alter table public.email_settings enable row level security;
alter table public.email_settings force row level security;
revoke all on public.email_preferences, public.email_suppressions, public.email_jobs,
  public.email_daily_budget, public.email_webhook_events, public.email_settings from public, anon, authenticated;
grant all on public.email_preferences, public.email_suppressions, public.email_jobs,
  public.email_daily_budget, public.email_webhook_events, public.email_settings to service_role;

create function public.email_set_consent(p_uid text, p_enabled boolean, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_email text;
begin
  select lower(email) into v_email from public.users
    where uid=p_uid and status='active' and email_verified=true and email is not null;
  if v_email is null then raise exception 'verified-email-required'; end if;
  -- A conscious new subscription can undo an unsubscribe, never a bounce or complaint.
  if p_enabled then
    delete from public.email_suppressions where email=v_email and reason='unsubscribe';
  else
    insert into public.email_suppressions values(v_email,'unsubscribe',p_now)
      on conflict(email) do nothing;
    update public.email_preferences set subscribed=false where email=v_email;
  end if;
  insert into public.email_preferences(uid,email,subscribed,consent_at,consent_version,last_active_at)
    values(p_uid,v_email,p_enabled,case when p_enabled then p_now else null end,'product-updates-v1',p_now)
    on conflict(uid) do update set email=excluded.email,subscribed=excluded.subscribed,
      consent_at=case when not email_preferences.subscribed or email_preferences.email<>excluded.email
        then excluded.consent_at else email_preferences.consent_at end,
      consent_version=excluded.consent_version,last_active_at=excluded.last_active_at;
  if not p_enabled then
    update public.email_jobs set status='cancelled',lease_until=null
      where email=v_email and status in ('pending','sending');
  end if;
end $$;

create function public.email_touch(p_uid text, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.email_preferences set last_active_at=greatest(last_active_at,p_now) where uid=p_uid;
  update public.email_jobs set status='cancelled',lease_until=null
    where uid=p_uid and status in ('pending','sending');
  update public.email_jobs set returned_at=p_now
    where uid=p_uid and status='sent' and returned_at is null and sent_at<p_now;
end $$;

create function public.email_unsubscribe(p_token uuid, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_email text;
begin
  select email into v_email from public.email_preferences where unsubscribe_token=p_token;
  if v_email is null then return; end if;
  insert into public.email_suppressions values(v_email,'unsubscribe',p_now)
    on conflict(email) do nothing;
  update public.email_preferences set subscribed=false where email=v_email;
  update public.email_jobs set status='cancelled',lease_until=null
    where email=v_email and status in ('pending','sending');
end $$;

create function public.email_prepare(p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  -- Existing editor activity is a second return signal, including older editor clients.
  update public.email_preferences p set last_active_at=a.at
    from (select uid,max(updated_at) as at from public.activity_daily group by uid) a
    where a.uid=p.uid and a.at>p.last_active_at;
  update public.email_jobs j set returned_at=p.last_active_at
    from public.email_preferences p where p.uid=j.uid and j.status='sent'
    and j.returned_at is null and p.last_active_at>j.sent_at;
  update public.email_jobs j set status='cancelled',lease_until=null
    where j.status in ('pending','sending') and not exists (
      select 1 from public.email_preferences p join public.users u on u.uid=p.uid
      where p.uid=j.uid and p.subscribed and p.email=j.email and lower(u.email)=j.email
      and u.status='active' and u.email_verified and p.last_active_at<=j.started_at
      and not exists(select 1 from public.email_suppressions s where s.email=j.email));
  insert into public.email_jobs(uid,email,step,started_at,due_at)
    select p.uid,p.email,s.step,p_now,p_now+s.delay
    from public.email_preferences p join public.users u on u.uid=p.uid
    cross join (values (0,0::bigint),(1,345600000::bigint),(2,864000000::bigint)) s(step,delay)
    where p.subscribed and p.consent_at is not null and u.status='active' and u.email_verified
      and lower(u.email)=p.email and p.last_active_at<=p_now-1209600000
      and not exists(select 1 from public.email_suppressions x where x.email=p.email)
      and not exists(select 1 from public.email_jobs x where x.uid=p.uid and x.campaign='return-v1')
    on conflict(email,campaign,step) do nothing;
end $$;

create function public.email_claim(p_now bigint, p_limit integer default 10)
returns setof public.email_jobs language plpgsql security invoker set search_path = '' as $$
declare v_day date := (to_timestamp(p_now/1000.0) at time zone 'UTC')::date;
  v_count integer; v_limit integer;
begin
  -- A transaction lock makes concurrent schedules share one daily send budget.
  perform pg_advisory_xact_lock(726314811);
  if not exists(select 1 from public.email_settings where enabled and length(trim(postal_address))>=10)
    then return; end if;
  insert into public.email_daily_budget(day) values(v_day) on conflict do nothing;
  select claimed into v_count from public.email_daily_budget where day=v_day for update;
  v_limit := least(greatest(p_limit,0),10,greatest(50-v_count,0));
  -- Provider idempotency expires at 24h: ambiguous older sends require manual review.
  update public.email_jobs set status='failed',last_error='retry-window-expired'
    where status in ('pending','sending') and first_attempt_at is not null and first_attempt_at<p_now-82800000;
  return query
    with candidates as (
      select j.id from public.email_jobs j
      join public.email_preferences p on p.uid=j.uid join public.users u on u.uid=j.uid
      where j.due_at<=p_now and j.attempts<5
        and (j.status='pending' or (j.status='sending' and j.lease_until<p_now))
        and p.subscribed and p.consent_at is not null and p.email=j.email
        and lower(u.email)=j.email and u.email_verified and u.status='active'
        and p.last_active_at<=j.started_at
        and not exists(select 1 from public.email_suppressions x where x.email=j.email)
        and not exists(select 1 from public.email_jobs earlier where earlier.email=j.email
          and earlier.campaign=j.campaign and earlier.step<j.step and earlier.status<>'sent')
      order by j.due_at,j.id for update of j skip locked limit v_limit
    )
    update public.email_jobs j set status='sending',attempts=attempts+1,
      first_attempt_at=coalesce(first_attempt_at,p_now),lease_until=p_now+600000
      from candidates c where j.id=c.id returning j.*;
  get diagnostics v_count = row_count;
  update public.email_daily_budget set claimed=claimed+v_count where day=v_day;
end $$;

create function public.email_apply_event(p_id text,p_type text,p_provider_id text,p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_email text; v_reason text;
begin
  insert into public.email_webhook_events(id,received_at,provider_id,kind)
    values(p_id,p_now,p_provider_id,p_type) on conflict do nothing;
  if exists(select 1 from public.email_webhook_events where id=p_id and processed) then return; end if;
  select email into v_email from public.email_jobs where provider_id=p_provider_id;
  if v_email is null then return; end if;
  if p_type='email.delivered' then
    update public.email_jobs set delivered_at=p_now where provider_id=p_provider_id;
  elsif p_type in ('email.bounced','email.complained') then
    v_reason := case when p_type='email.complained' then 'complaint' else 'bounce' end;
    insert into public.email_suppressions values(v_email,v_reason,p_now)
      on conflict(email) do update set reason=excluded.reason;
    update public.email_preferences set subscribed=false where email=v_email;
    update public.email_jobs set status='cancelled',lease_until=null
      where email=v_email and status in ('pending','sending');
  end if;
  update public.email_webhook_events set processed=true where id=p_id;
end $$;
revoke execute on function public.email_set_consent(text,boolean,bigint),
  public.email_touch(text,bigint),public.email_unsubscribe(uuid,bigint),
  public.email_prepare(bigint),public.email_claim(bigint,integer),
  public.email_apply_event(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.email_set_consent(text,boolean,bigint),
  public.email_touch(text,bigint),public.email_unsubscribe(uuid,bigint),
  public.email_prepare(bigint),public.email_claim(bigint,integer),
  public.email_apply_event(text,text,text,bigint) to service_role;

create function public.email_is_eligible(p_id uuid,p_now bigint)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(
    select 1 from public.email_jobs j
    join public.email_preferences p on p.uid=j.uid join public.users u on u.uid=j.uid
    where j.id=p_id and j.status='sending' and j.lease_until>=p_now
      and p.subscribed and p.consent_at is not null and p.email=j.email
      and lower(u.email)=j.email and u.email_verified and u.status='active'
      and p.last_active_at<=j.started_at
      and not exists(select 1 from public.email_suppressions s where s.email=j.email)
      and not exists(select 1 from public.activity_daily a where a.uid=j.uid and a.updated_at>j.started_at)
      and exists(select 1 from public.email_settings where enabled and length(trim(postal_address))>=10)
  );
$$;
revoke execute on function public.email_is_eligible(uuid,bigint) from public,anon,authenticated;
grant execute on function public.email_is_eligible(uuid,bigint) to service_role;


-- Webhooks can arrive before the provider id acknowledgement is persisted.
create function public.email_reconcile(p_provider_id text)
returns void language plpgsql security invoker set search_path = '' as $$
declare e record;
begin
  for e in select * from public.email_webhook_events where provider_id=p_provider_id and not processed loop
    perform public.email_apply_event(e.id,e.kind,e.provider_id,e.received_at);
  end loop;
end $$;
revoke execute on function public.email_reconcile(text) from public,anon,authenticated;
grant execute on function public.email_reconcile(text) to service_role;
