-- Receipts use signed successful charges, never subscription state or list prices.
-- Only new purchases are eligible; historical backfill requires an explicit operator choice.
begin;
set local lock_timeout = '5s';
alter table public.email_settings add column if not exists purchase_receipt_since bigint
  not null default ((extract(epoch from now())*1000)::bigint);

create table public.purchase_receipt_payments (
  payment_id text primary key check(length(payment_id) between 1 and 200), webhook_id text not null unique,
  subscription_id text, order_id text, customer_id text not null,
  amount_minor bigint not null check(amount_minor between 0 and 9007199254740991),
  currency text not null check(currency ~ '^[A-Z]{3}$'), paid_at bigint not null, received_at bigint not null,
  status text not null default 'pending' check(status in ('pending','queued','ignored','review')),
  retry_at bigint not null, reason text, check(subscription_id is not null or order_id is not null)
);
create index purchase_receipt_payment_due_idx on public.purchase_receipt_payments(retry_at,payment_id) where status='pending';
alter table public.purchase_receipt_payments enable row level security;
alter table public.purchase_receipt_payments force row level security;
revoke all on public.purchase_receipt_payments from public,anon,authenticated;
grant all on public.purchase_receipt_payments to service_role;

create table public.purchase_receipt_jobs (
  id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('plan','tokens','advertiser-credit')),
  source_id text not null unique references public.purchase_receipt_payments(payment_id),
  uid text not null references public.users(uid), email text not null, name text not null, details jsonb not null,
  created_at bigint not null, due_at bigint not null,
  status text not null default 'pending' check(status in ('pending','sending','sent','failed','cancelled')),
  attempts integer not null default 0, first_attempt_at bigint, lease_until bigint, lease_token uuid,
  outbound_payload jsonb,
  provider_id text, sent_at bigint, delivered_at bigint, last_error text,
  needs_reconcile boolean not null default false
);
create index purchase_receipt_due_idx on public.purchase_receipt_jobs(due_at,id) where status in ('pending','sending');
create index purchase_receipt_provider_idx on public.purchase_receipt_jobs(provider_id) where provider_id is not null;
create index purchase_receipt_email_idx on public.purchase_receipt_jobs(email) where status in ('pending','sending');
create index purchase_receipt_reconcile_idx on public.purchase_receipt_jobs(id) where needs_reconcile and provider_id is not null;
alter table public.purchase_receipt_jobs enable row level security;
alter table public.purchase_receipt_jobs force row level security;
revoke all on public.purchase_receipt_jobs from public,anon,authenticated;
grant all on public.purchase_receipt_jobs to service_role;

-- Called only after raw webhook signature verification. This grants no access or balance.
create function public.email_record_purchase_payment(p_payment text,p_webhook text,p_subscription text,p_order text,
  p_customer text,p_amount bigint,p_currency text,p_paid_at bigint,p_received_at bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare old public.purchase_receipt_payments%rowtype;
begin
  if not exists(select 1 from public.email_settings where singleton
    and p_paid_at>=purchase_receipt_since and p_received_at>=purchase_receipt_since) then return; end if;
  insert into public.purchase_receipt_payments(payment_id,webhook_id,subscription_id,order_id,customer_id,amount_minor,currency,paid_at,received_at,retry_at)
    values(p_payment,p_webhook,p_subscription,p_order,p_customer,p_amount,p_currency,p_paid_at,p_received_at,p_received_at)
    on conflict(payment_id) do nothing;
  select * into old from public.purchase_receipt_payments where payment_id=p_payment for update;
  if old.subscription_id is distinct from p_subscription or old.order_id is distinct from p_order
    or old.customer_id<>p_customer or old.amount_minor<>p_amount or old.currency<>p_currency then
    update public.purchase_receipt_payments set status='review',reason='conflicting-charge' where payment_id=p_payment;
    update public.purchase_receipt_jobs set status='cancelled',lease_until=null,last_error='conflicting-charge'
      where source_id=p_payment and status in ('pending','sending');
  end if;
end $$;

-- At most 100 due journal rows per run, with primary-key source lookups. No historical
-- subscription/order/usage scan, and no inference of payment from a current plan period.
create function public.email_prepare_purchase_receipts(p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare p public.purchase_receipt_payments%rowtype; s public.ai_subscriptions%rowtype;
  o public.ai_token_orders%rowtype; c public.advertiser_credit_orders%rowtype;
  u public.users%rowtype; buyer text; receipt_kind text; facts jsonb; invalid boolean;
begin
  -- A send acknowledgement commits before reconciliation. Retry any interrupted
  -- reconciliation in a bounded index-driven sweep without prelocking receipt rows.
  perform public.email_reconcile_purchase_receipt(j.id) from
    (select id from public.purchase_receipt_jobs where needs_reconcile and provider_id is not null order by id limit 100) j;
  for p in select * from public.purchase_receipt_payments where status='pending' and retry_at<=p_now
    order by retry_at,payment_id for update skip locked limit 100
  loop
    if p.received_at<p_now-604800000 then
      update public.purchase_receipt_payments set status='ignored',reason='unmatched-charge-expired' where payment_id=p.payment_id;
      continue;
    end if;
    buyer:=null; receipt_kind:=null; facts:=null; invalid:=false;
    if p.subscription_id is not null then
      select * into s from public.ai_subscriptions where provider_subscription_id=p.subscription_id;
      if found and s.customer_id is not null then
        if s.customer_id<>p.customer_id then invalid:=true;
        else buyer:=s.uid; receipt_kind:='plan'; facts:=jsonb_build_object('kind','plan','subscriptionId',p.subscription_id); end if;
      end if;
    elsif p.order_id like 'ait\_%' escape '\' then
      select * into o from public.ai_token_orders where order_id=p.order_id;
      if found and o.provider_payment_id is not null then
        if o.provider_payment_id<>p.payment_id or o.paid_at is null or o.status<>'paid' then invalid:=true;
        else buyer:=o.uid; receipt_kind:='tokens'; facts:=jsonb_build_object('kind','tokens','packId',o.pack_id,'tokens',o.tokens); end if;
      end if;
    elsif p.order_id is not null then
      select * into c from public.advertiser_credit_orders where order_id=p.order_id;
      if found and c.provider_payment_id is not null then
        if c.provider_payment_id<>p.payment_id or c.status<>'paid' then invalid:=true;
        else
          -- Resolve the billing email only through verified owners of this advertiser,
          -- never webhook customer.email or a global email scan.
          select usr.uid into buyer from public.advertisers a cross join lateral unnest(a.owner_uids) owner_uid
            join public.users usr on usr.uid=owner_uid where a.advertiser_id=c.advertiser_id
              and usr.status='active' and usr.email_verified and lower(usr.email)=lower(c.customer_email)
            order by usr.uid limit 1;
          receipt_kind:='advertiser-credit'; facts:=jsonb_build_object('kind','advertiser-credit');
        end if;
      end if;
    end if;
    if invalid then
      update public.purchase_receipt_payments set status='review',reason='purchase-not-matched' where payment_id=p.payment_id; continue;
    end if;
    if buyer is not null then
      select * into u from public.users where uid=buyer;
      if not found or u.status<>'active' or not u.email_verified or u.email is null or length(trim(u.email))=0 then buyer:=null; end if;
    end if;
    if buyer is null or facts is null then
      -- Either webhook can arrive first. Retry unmatched charges without blocking newer rows.
      update public.purchase_receipt_payments set retry_at=p_now+900000,reason='awaiting-owned-purchase' where payment_id=p.payment_id; continue;
    end if;
    if exists(select 1 from public.email_suppressions where email=lower(u.email) and reason in ('bounce','complaint')) then
      update public.purchase_receipt_payments set status='ignored',reason='suppressed' where payment_id=p.payment_id; continue;
    end if;
    insert into public.purchase_receipt_jobs(kind,source_id,uid,email,name,details,created_at,due_at)
      values(receipt_kind,p.payment_id,buyer,lower(u.email),coalesce(nullif(left(trim(u.display_name),80),''),'there'),
        facts||jsonb_build_object('amountMinor',p.amount_minor,'currency',p.currency,'paidAt',p.paid_at,'reference',p.payment_id),p_now,p_now)
      on conflict(source_id) do nothing;
    update public.purchase_receipt_payments set status='queued',reason=null where payment_id=p.payment_id;
  end loop;
end $$;

-- No marketing switch or campaign budget. Work, expiry and suppression processing are bounded.
create function public.email_claim_purchase_receipts(p_now bigint,p_limit integer default 10)
returns setof public.purchase_receipt_jobs language plpgsql security invoker set search_path = '' as $$
declare j public.purchase_receipt_jobs%rowtype; sent integer:=0; cap integer:=least(greatest(p_limit,0),10);
begin
  if cap=0 or not exists(select 1 from public.email_settings where sender_verified_at is not null and length(trim(postal_address))>=10) then return; end if;
  for j in select * from public.purchase_receipt_jobs where due_at<=p_now
    and (status='pending' or status='sending' and lease_until<p_now) order by due_at,id for update skip locked limit 100
  loop
    if j.created_at<p_now-604800000 or j.first_attempt_at<p_now-82800000 or j.attempts>=5 then
      update public.purchase_receipt_jobs set status='failed',last_error='retry-window-expired',lease_until=null where id=j.id;
    elsif exists(select 1 from public.email_suppressions where email=j.email and reason in ('bounce','complaint'))
      or not exists(select 1 from public.users where uid=j.uid and status='active' and email_verified and lower(email)=j.email) then
      update public.purchase_receipt_jobs set status='cancelled',last_error='recipient-no-longer-eligible',lease_until=null where id=j.id;
    else
      update public.purchase_receipt_jobs set status='sending',attempts=attempts+1,
        first_attempt_at=coalesce(first_attempt_at,p_now),lease_until=p_now+600000,due_at=p_now+600000,
        lease_token=gen_random_uuid() where id=j.id returning * into j;
      return next j; sent:=sent+1; exit when sent>=cap;
    end if;
  end loop;
end $$;

create function public.email_purchase_receipt_eligible(p_id uuid,p_lease uuid,p_now bigint)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.purchase_receipt_jobs j where j.id=p_id and j.status='sending'
    and j.lease_token=p_lease and j.lease_until>=p_now and j.first_attempt_at>=p_now-82800000
    and exists(select 1 from public.email_settings where sender_verified_at is not null and length(trim(postal_address))>=10)
    and exists(select 1 from public.users where uid=j.uid and status='active' and email_verified and lower(email)=j.email)
    and not exists(select 1 from public.email_suppressions where email=j.email and reason in ('bounce','complaint')));
$$;

-- First writer freezes the complete provider request. Later deployments and address
-- formatting changes cannot mutate an accepted-but-unacknowledged retry's body.
create function public.email_purchase_receipt_payload(p_id uuid,p_lease uuid,p_payload jsonb,p_now bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare j public.purchase_receipt_jobs%rowtype;
begin
  select * into j from public.purchase_receipt_jobs where id=p_id for update;
  if not found or not public.email_purchase_receipt_eligible(p_id,p_lease,p_now) then return null; end if;
  if j.outbound_payload is not null then return j.outbound_payload; end if;
  if p_payload is null then return null; end if;
  if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>200000
    or coalesce(jsonb_typeof(p_payload->'subject'),'null')<>'string' or length(p_payload->>'subject') not between 1 and 500
    or coalesce(jsonb_typeof(p_payload->'html'),'null')<>'string' or length(p_payload->>'html')<1
    or coalesce(jsonb_typeof(p_payload->'text'),'null')<>'string' or length(p_payload->>'text')<1
    or coalesce(jsonb_typeof(p_payload->'from'),'null')<>'string' or length(p_payload->>'from')<1
    or coalesce(jsonb_typeof(p_payload->'reply_to'),'null')<>'string' or length(p_payload->>'reply_to')<1
    or coalesce(jsonb_typeof(p_payload->'tags'),'null')<>'array'
    or p_payload->'to' is distinct from jsonb_build_array(j.email) then
    raise exception 'Invalid receipt provider payload';
  end if;
  update public.purchase_receipt_jobs set outbound_payload=p_payload where id=p_id;
  return p_payload;
end $$;

create function public.email_finish_purchase_receipt(p_id uuid,p_lease uuid,p_provider_id text,p_retry boolean,p_code text,p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_provider_id is not null then
    update public.purchase_receipt_jobs set status=case when status='cancelled' or last_error='provider-email-failed' then status else 'sent' end,
      provider_id=p_provider_id,sent_at=coalesce(sent_at,p_now),lease_until=null,
      last_error=case when last_error in ('provider-email-failed','provider-email-suppressed','provider-email-bounced','provider-email-complained') then last_error else null end,
      needs_reconcile=true
      where id=p_id and (provider_id is null or provider_id=p_provider_id);
  else
    update public.purchase_receipt_jobs set status=case when p_retry and attempts<5 then 'pending' else 'failed' end,
      due_at=p_now+least(21600000,60000*(2^attempts)::bigint),lease_until=null,last_error=p_code
      where id=p_id and status='sending' and lease_token=p_lease;
  end if;
end $$;

-- Extend the installed handler instead of replacing all existing mail kinds with a stale copy.
alter function public.email_apply_event(text,text,text,bigint) rename to email_apply_event_before_purchase_receipts;
create function public.email_apply_event(p_id text,p_type text,p_provider_id text,p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare recipient text;
begin
  if exists(select 1 from public.email_webhook_events where id=p_id and processed) then return; end if;
  perform public.email_apply_event_before_purchase_receipts(p_id,p_type,p_provider_id,p_now);
  select email into recipient from public.purchase_receipt_jobs where provider_id=p_provider_id limit 1;
  if recipient is null then return; end if;
  if p_type='email.delivered' then
    update public.purchase_receipt_jobs set delivered_at=coalesce(delivered_at,p_now),
      status=case when last_error='provider-email-failed' then 'sent' else status end,
      last_error=case when last_error='provider-email-failed' then null else last_error end where provider_id=p_provider_id;
  elsif p_type in ('email.failed','email.suppressed') then
    -- The provider accepted the request but did not deliver it. Record that fact;
    -- do not retry an already accepted idempotency key or invent a bounce reason.
    update public.purchase_receipt_jobs set status=case when p_type='email.suppressed' then 'cancelled' else 'failed' end,
      lease_until=null,last_error=case when p_type='email.suppressed' then 'provider-email-suppressed' else 'provider-email-failed' end
      where provider_id=p_provider_id and delivered_at is null;
  elsif p_type in ('email.bounced','email.complained') then
    insert into public.email_suppressions values(recipient,case when p_type='email.complained' then 'complaint' else 'bounce' end,p_now)
      on conflict(email) do update set reason=excluded.reason;
    update public.email_preferences set subscribed=false,status_updates=false,status_consent_at=null,model_updates=false,model_consent_at=null where email=recipient;
    update public.purchase_receipt_jobs set status='cancelled',lease_until=null where email=recipient and status in ('pending','sending');
    update public.purchase_receipt_jobs set status='cancelled',lease_until=null,
      last_error=case when p_type='email.complained' then 'provider-email-complained' else 'provider-email-bounced' end
      where provider_id=p_provider_id;
  end if;
  update public.email_webhook_events set processed=true where id=p_id;
end $$;

-- No receipt row is locked before legacy event processing takes the suppression
-- and per-email locks. An ACK transaction can never wait for another job here.
create function public.email_reconcile_purchase_receipt(p_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare provider text;
begin
  select provider_id into provider from public.purchase_receipt_jobs where id=p_id and needs_reconcile;
  if provider is null then return; end if;
  perform public.email_reconcile(provider);
  update public.purchase_receipt_jobs set needs_reconcile=false where id=p_id and provider_id=provider
    and not exists(select 1 from public.email_webhook_events where provider_id=provider and not processed);
end $$;

revoke all on function public.email_record_purchase_payment(text,text,text,text,text,bigint,text,bigint,bigint),
  public.email_prepare_purchase_receipts(bigint),public.email_claim_purchase_receipts(bigint,integer),
  public.email_purchase_receipt_eligible(uuid,uuid,bigint),public.email_purchase_receipt_payload(uuid,uuid,jsonb,bigint),
  public.email_finish_purchase_receipt(uuid,uuid,text,boolean,text,bigint),public.email_reconcile_purchase_receipt(uuid),
  public.email_apply_event(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.email_record_purchase_payment(text,text,text,text,text,bigint,text,bigint,bigint),
  public.email_prepare_purchase_receipts(bigint),public.email_claim_purchase_receipts(bigint,integer),
  public.email_purchase_receipt_eligible(uuid,uuid,bigint),public.email_purchase_receipt_payload(uuid,uuid,jsonb,bigint),
  public.email_finish_purchase_receipt(uuid,uuid,text,boolean,text,bigint),public.email_reconcile_purchase_receipt(uuid),
  public.email_apply_event(text,text,text,bigint) to service_role;
commit;
