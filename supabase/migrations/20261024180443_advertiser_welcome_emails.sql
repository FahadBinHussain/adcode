-- One setup email for newly created advertiser workspaces. Existing advertisers are
-- not backfilled and no product/marketing subscription is created by this workflow.
alter table public.email_settings add column if not exists advertiser_welcome_since bigint
  not null default ((extract(epoch from now()) * 1000)::bigint);

create table public.advertiser_welcome_jobs (
  id uuid primary key default gen_random_uuid(),
  advertiser_id text not null unique references public.advertisers(advertiser_id) on delete cascade,
  uid text not null, email text not null, name text not null,
  created_at bigint not null, due_at bigint not null,
  status text not null default 'pending' check(status in ('pending','sending','sent','failed','cancelled')),
  attempts integer not null default 0,
  first_attempt_at bigint, lease_until bigint, provider_id text, sent_at bigint, delivered_at bigint, last_error text
);
create index advertiser_welcome_due_idx on public.advertiser_welcome_jobs(due_at) where status in ('pending','sending');
create index advertiser_welcome_provider_idx on public.advertiser_welcome_jobs(provider_id) where provider_id is not null;
alter table public.advertiser_welcome_jobs enable row level security;
alter table public.advertiser_welcome_jobs force row level security;
revoke all on public.advertiser_welcome_jobs from public, anon, authenticated;
grant all on public.advertiser_welcome_jobs to service_role;

create function public.email_prepare_advertiser_welcomes(p_now bigint)
returns void language sql security invoker set search_path = '' as $$
  insert into public.advertiser_welcome_jobs(advertiser_id,uid,email,name,created_at,due_at)
    select a.advertiser_id,u.uid,lower(u.email),a.name,a.created_at,p_now
    from public.advertisers a join public.users u on u.uid=a.owner_uids[1]
    cross join public.email_settings s
    where s.singleton and a.created_at >= s.advertiser_welcome_since
      and a.created_at >= p_now - 604800000 and a.created_at <= p_now
      and a.status='active' and u.status='active' and u.email_verified and u.email is not null
      and not exists(select 1 from public.email_suppressions x where x.email=lower(u.email))
    on conflict(advertiser_id) do nothing;
$$;

create function public.email_claim_advertiser_welcomes(p_now bigint,p_limit integer default 10)
returns setof public.advertiser_welcome_jobs language plpgsql security invoker set search_path = '' as $$
declare v_day date := (to_timestamp(p_now/1000.0) at time zone 'UTC')::date; v_count integer; v_limit integer;
begin
  perform pg_advisory_xact_lock(726314811);
  if not exists(select 1 from public.email_settings where enabled and sender_verified_at is not null and length(trim(postal_address))>=10) then return; end if;
  insert into public.email_daily_budget(day) values(v_day) on conflict do nothing;
  select claimed into v_count from public.email_daily_budget where day=v_day for update;
  v_limit := least(greatest(p_limit,0),10,greatest(50-v_count,0));
  update public.advertiser_welcome_jobs set status='failed',last_error='retry-window-expired',lease_until=null
    where status in ('pending','sending') and (created_at < p_now - 604800000 or first_attempt_at < p_now - 82800000 or attempts>=5 and lease_until < p_now);
  return query
    with candidates as (
      select j.id from public.advertiser_welcome_jobs j
      join public.advertisers a on a.advertiser_id=j.advertiser_id
      join public.users u on u.uid=j.uid
      where j.due_at<=p_now and j.attempts<5
        and (j.status='pending' or j.status='sending' and j.lease_until<p_now)
        and a.status='active' and j.uid=any(a.owner_uids)
        and u.status='active' and u.email_verified and lower(u.email)=j.email
        and not exists(select 1 from public.email_suppressions x where x.email=j.email)
      order by j.created_at,j.id for update of j skip locked limit v_limit
    ), claimed as (
      update public.advertiser_welcome_jobs j set status='sending',attempts=j.attempts+1,
        first_attempt_at=coalesce(j.first_attempt_at,p_now),lease_until=p_now+600000
      from candidates c where j.id=c.id returning j.*
    ) select * from claimed;
  get diagnostics v_count = row_count;
  update public.email_daily_budget set claimed=claimed+v_count where day=v_day;
end $$;

create function public.email_advertiser_welcome_eligible(p_id uuid,p_now bigint)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.advertiser_welcome_jobs j
    join public.advertisers a on a.advertiser_id=j.advertiser_id join public.users u on u.uid=j.uid
    where j.id=p_id and j.status='sending' and j.lease_until>=p_now and j.first_attempt_at>=p_now-82800000
      and a.status='active' and j.uid=any(a.owner_uids) and u.status='active' and u.email_verified and lower(u.email)=j.email
      and exists(select 1 from public.email_settings where enabled and sender_verified_at is not null and length(trim(postal_address))>=10)
      and not exists(select 1 from public.email_suppressions x where x.email=j.email));
$$;

create function public.email_finish_advertiser_welcome(p_id uuid,p_provider_id text,p_retry boolean,p_code text,p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_provider_id is not null then
    update public.advertiser_welcome_jobs set status='sent',provider_id=p_provider_id,sent_at=p_now,lease_until=null,last_error=null where id=p_id;
    perform public.email_reconcile(p_provider_id);
  else
    update public.advertiser_welcome_jobs set status=case when p_retry and attempts<5 then 'pending' else 'failed' end,
      due_at=p_now+least(21600000,60000*(2^attempts)::bigint),lease_until=null,last_error=p_code
      where id=p_id and status='sending';
  end if;
end $$;

-- Preserve handling of every existing kind of email while recognizing welcome receipts.
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
    (select email from public.report_replies where provider_id=p_provider_id limit 1),
    (select email from public.status_alert_jobs where provider_id=p_provider_id limit 1),
    (select email from public.status_subscribers where confirm_provider_id=p_provider_id limit 1),
    (select email from public.advertiser_welcome_jobs where provider_id=p_provider_id limit 1));
  if v_email is null then return; end if;
  if p_type='email.delivered' then
    update public.email_jobs set delivered_at=p_now where provider_id=p_provider_id;
    update public.email_announcement_jobs set delivered_at=p_now where provider_id=p_provider_id;
    update public.report_replies set delivered_at=p_now where provider_id=p_provider_id;
    update public.status_alert_jobs set delivered_at=p_now where provider_id=p_provider_id;
    update public.advertiser_welcome_jobs set delivered_at=p_now where provider_id=p_provider_id;
  elsif p_type in ('email.bounced','email.complained') then
    v_reason := case when p_type='email.complained' then 'complaint' else 'bounce' end;
    insert into public.email_suppressions values(v_email,v_reason,p_now) on conflict(email) do update set reason=excluded.reason;
    update public.email_preferences set subscribed=false,status_updates=false,status_consent_at=null,model_updates=false,model_consent_at=null where email=v_email;
    update public.email_jobs set status='cancelled',lease_until=null where email=v_email and status in ('pending','sending');
    update public.email_announcement_jobs set status='cancelled',lease_until=null where email=v_email and status in ('pending','sending');
    update public.status_subscribers set state='unsubscribed',models=false,incidents=false,confirm_token=null,unsubscribed_at=p_now where email=v_email;
    update public.status_alert_jobs set status='cancelled',lease_until=null where email=v_email and status in ('pending','sending');
    update public.advertiser_welcome_jobs set status='cancelled',lease_until=null where email=v_email and status in ('pending','sending');
  end if;
  update public.email_webhook_events set processed=true where id=p_id;
end $$;

revoke all on function public.email_prepare_advertiser_welcomes(bigint),public.email_claim_advertiser_welcomes(bigint,integer),public.email_advertiser_welcome_eligible(uuid,bigint),public.email_finish_advertiser_welcome(uuid,text,boolean,text,bigint) from public,anon,authenticated;
grant execute on function public.email_prepare_advertiser_welcomes(bigint),public.email_claim_advertiser_welcomes(bigint,integer),public.email_advertiser_welcome_eligible(uuid,bigint),public.email_finish_advertiser_welcome(uuid,text,boolean,text,bigint) to service_role;
