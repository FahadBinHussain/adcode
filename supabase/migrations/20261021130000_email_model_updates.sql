-- A third separate yes: emails about the AI models included with ADCode - a new free model, and a
-- report on how each one has been performing (uptime, error rate and speed, from the same measured
-- turns the status page shows). Same sender, suppressions, daily budget and webhook as the other
-- announcements (20261021110000); only the consent and the topic are new.
--
-- Like status updates, model emails carry their own unsubscribe link that stops model emails and
-- nothing else, and the global unsubscribe, a bounce or a complaint stops them with everything else.
begin;

alter table public.email_preferences
  add column if not exists model_updates boolean not null default false,
  add column if not exists model_consent_at bigint;

alter table public.email_announcements drop constraint if exists email_announcements_topic_check;
alter table public.email_announcements add constraint email_announcements_topic_check check (topic in ('product','status','models'));

-- The model yes, exactly like the status yes: ticking it undoes an ordinary unsubscribe (never a
-- bounce or complaint), and leaves every other consent as it was.
create or replace function public.email_set_model_updates(p_uid text, p_enabled boolean, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_email text;
begin
  select lower(email) into v_email from public.users
    where uid=p_uid and status='active' and email_verified=true and email is not null;
  if v_email is null then raise exception 'verified-email-required'; end if;
  if p_enabled then
    delete from public.email_suppressions where email=v_email and reason='unsubscribe';
  end if;
  insert into public.email_preferences(uid,email,subscribed,consent_at,consent_version,last_active_at,model_updates,model_consent_at)
    values(p_uid,v_email,false,null,'product-updates-v1',p_now,p_enabled,case when p_enabled then p_now else null end)
    on conflict(uid) do update set
      -- A changed address carries none of the old address's consent.
      subscribed=case when email_preferences.email<>excluded.email then false else email_preferences.subscribed end,
      status_updates=case when email_preferences.email<>excluded.email then false else email_preferences.status_updates end,
      status_consent_at=case when email_preferences.email<>excluded.email then null else email_preferences.status_consent_at end,
      email=excluded.email,
      model_updates=excluded.model_updates,
      model_consent_at=case
        when not excluded.model_updates then null
        when not email_preferences.model_updates or email_preferences.email<>excluded.email then p_now
        else email_preferences.model_consent_at end;
  if not p_enabled then
    update public.email_announcement_jobs j set status='cancelled',lease_until=null
      from public.email_announcements a
      where a.id=j.announcement_id and a.topic='models' and j.uid=p_uid and j.status in ('pending','sending');
  end if;
end $$;

-- Whether a person's preferences cover a topic. One place, so queueing and claiming agree.
create or replace function public.email_topic_consented(p_topic text, p public.email_preferences)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select case p_topic
    when 'product' then p.subscribed and p.consent_at is not null
    when 'status' then p.status_updates and p.status_consent_at is not null
    when 'models' then p.model_updates and p.model_consent_at is not null
    else false end
$$;

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
    where public.email_topic_consented(p_topic, p)
      and u.status='active' and u.email_verified and lower(u.email)=p.email
      and not exists(select 1 from public.email_suppressions s where s.email=p.email)
    on conflict(announcement_id,email) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

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
        and public.email_topic_consented(a.topic, p)
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

-- The model email's own unsubscribe: it stops model emails and nothing else.
create or replace function public.email_unsubscribe_models(p_token uuid, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_uid text;
begin
  update public.email_preferences set model_updates=false,model_consent_at=null
    where unsubscribe_token=p_token returning uid into v_uid;
  if v_uid is null then return; end if;
  update public.email_announcement_jobs j set status='cancelled',lease_until=null
    from public.email_announcements a
    where a.id=j.announcement_id and a.topic='models' and j.uid=v_uid and j.status in ('pending','sending');
end $$;

create or replace function public.email_unsubscribe(p_token uuid, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_email text;
begin
  select email into v_email from public.email_preferences where unsubscribe_token=p_token;
  if v_email is null then return; end if;
  insert into public.email_suppressions values(v_email,'unsubscribe',p_now)
    on conflict(email) do nothing;
  update public.email_preferences set subscribed=false,status_updates=false,status_consent_at=null,model_updates=false,model_consent_at=null where email=v_email;
  update public.email_jobs set status='cancelled',lease_until=null
    where email=v_email and status in ('pending','sending');
  update public.email_announcement_jobs set status='cancelled',lease_until=null
    where email=v_email and status in ('pending','sending');
end $$;

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
    update public.email_preferences set subscribed=false,status_updates=false,status_consent_at=null,model_updates=false,model_consent_at=null where email=v_email;
    update public.email_jobs set status='cancelled',lease_until=null
      where email=v_email and status in ('pending','sending');
    update public.email_announcement_jobs set status='cancelled',lease_until=null
      where email=v_email and status in ('pending','sending');
  end if;
  update public.email_webhook_events set processed=true where id=p_id;
end $$;

revoke execute on function public.email_set_model_updates(text,boolean,bigint),
  public.email_topic_consented(text,public.email_preferences),
  public.email_unsubscribe_models(uuid,bigint) from public,anon,authenticated;
grant execute on function public.email_set_model_updates(text,boolean,bigint),
  public.email_topic_consented(text,public.email_preferences),
  public.email_unsubscribe_models(uuid,bigint) to service_role;

commit;
