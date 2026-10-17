-- The deployed sender is checked once during setup using the control-plane connection.
-- Runtime credentials only have sending access, restricted to the verified domain.
alter table public.email_settings add column sender_verified_at bigint;
alter table public.email_settings add constraint email_launch_requirements check (
  not enabled or (sender_verified_at is not null and postal_address is not null and length(trim(postal_address))>=10)
);
alter table public.email_suppressions drop constraint email_suppressions_reason_check;
alter table public.email_suppressions add constraint email_suppressions_reason_check
  check(reason in ('unsubscribe','bounce','complaint','provider-suppression'));
create or replace function public.email_apply_event(p_id text,p_type text,p_provider_id text,p_now bigint)
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
  elsif p_type in ('email.bounced','email.complained','email.suppressed') then
    v_reason := case when p_type='email.complained' then 'complaint' when p_type='email.suppressed' then 'provider-suppression' else 'bounce' end;
    insert into public.email_suppressions values(v_email,v_reason,p_now)
      on conflict(email) do update set reason=excluded.reason;
    update public.email_preferences set subscribed=false where email=v_email;
    update public.email_jobs set status='cancelled',lease_until=null
      where email=v_email and status in ('pending','sending');
  end if;
  if p_type='email.failed' then update public.email_jobs set status='failed',last_error='provider-failed' where provider_id=p_provider_id; end if;
  update public.email_webhook_events set processed=true where id=p_id;
end $$;
