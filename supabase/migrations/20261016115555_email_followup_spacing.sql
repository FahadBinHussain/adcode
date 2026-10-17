-- Follow-ups wait four and six days after the preceding accepted send.
-- This prevents quota backlogs or retries from compressing the sequence.
create or replace function public.email_claim(p_now bigint, p_limit integer default 10)
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
      and (j.step=0 or exists(
        select 1 from public.email_jobs prior
        where prior.email=j.email and prior.campaign=j.campaign and prior.step=j.step-1
          and prior.status='sent' and prior.sent_at is not null
          and prior.sent_at<=p_now-(case when j.step=1 then 345600000::bigint else 518400000::bigint end)))
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


create or replace function public.email_is_eligible(p_id uuid,p_now bigint)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(
    select 1 from public.email_jobs j
    join public.email_preferences p on p.uid=j.uid join public.users u on u.uid=j.uid
    where j.id=p_id and j.status='sending' and j.lease_until>=p_now
      and p.subscribed and p.consent_at is not null and p.email=j.email
      and lower(u.email)=j.email and u.email_verified and u.status='active'
      and p.last_active_at<=j.started_at
      and (j.step=0 or exists(
        select 1 from public.email_jobs prior
        where prior.email=j.email and prior.campaign=j.campaign and prior.step=j.step-1
          and prior.status='sent' and prior.sent_at is not null
          and prior.sent_at<=p_now-(case when j.step=1 then 345600000::bigint else 518400000::bigint end)))
      and not exists(select 1 from public.email_jobs earlier where earlier.email=j.email and earlier.campaign=j.campaign and earlier.step<j.step and earlier.status<>'sent')
      and not exists(select 1 from public.email_suppressions s where s.email=j.email)
      and not exists(select 1 from public.activity_daily a where a.uid=j.uid and a.updated_at>j.started_at)
      and exists(select 1 from public.email_settings where enabled and length(trim(postal_address))>=10)
  );
$$;
