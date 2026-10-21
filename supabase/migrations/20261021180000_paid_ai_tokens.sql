-- Paid AI tokens: a free weekly allowance on paid providers' models, then purchased tokens.
-- Rules: services/api/src/paidTokens.ts. Additive: the deployed relay keeps calling
-- reserve_unlimited_ai until the code that calls reserve_ai_with_tokens is deployed, and the new
-- settle_included_ai body settles old reservations exactly as before (their token holds are 0).
begin;

-- A 'paid_week' row is the free paid-model allowance; in it the millicredit columns hold tokens.
alter table public.ai_credit_windows drop constraint if exists ai_credit_windows_kind_check;
alter table public.ai_credit_windows add constraint ai_credit_windows_kind_check check (kind in ('session', 'week', 'paid_week'));

-- Purchased tokens per account. `purchased` may sit slightly below zero after one long request.
create table public.ai_token_balances (
  uid text primary key,
  purchased bigint not null default 0,
  reserved bigint not null default 0 check (reserved >= 0),
  updated_at bigint not null default 0
);
create table public.ai_token_orders (
  order_id text primary key check (order_id like 'ait\_%'),
  uid text not null,
  pack_id text not null,
  price_cents integer not null check (price_cents > 0),
  tokens bigint not null check (tokens > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'refunded', 'abandoned')),
  checkout_session text,
  provider_payment_id text unique,
  created_at bigint not null,
  paid_at bigint
);
create index ai_token_orders_uid on public.ai_token_orders (uid, created_at desc);
-- Every change to a balance, so it can always be explained.
create table public.ai_token_ledger (
  id uuid primary key default gen_random_uuid(),
  uid text not null,
  delta bigint not null check (delta <> 0),
  kind text not null check (kind in ('purchase', 'usage', 'refund', 'grant')),
  ref text not null,
  note text not null default '' check (length(note) <= 500),
  created_at bigint not null
);
create index ai_token_ledger_uid on public.ai_token_ledger (uid, created_at desc);
-- A payment or refund can only ever be applied once.
create unique index ai_token_ledger_once on public.ai_token_ledger (kind, ref) where kind in ('purchase', 'refund');
-- What each reservation holds from each pool, so settlement releases exactly that.
alter table public.tagflow_reservations
  add column free_tokens bigint not null default 0 check (free_tokens >= 0),
  add column paid_tokens bigint not null default 0 check (paid_tokens >= 0),
  add column paid_week_started_at bigint;

alter table public.ai_token_balances enable row level security;
alter table public.ai_token_orders enable row level security;
alter table public.ai_token_ledger enable row level security;
revoke all on public.ai_token_balances, public.ai_token_orders, public.ai_token_ledger from anon, authenticated;
grant all on public.ai_token_balances, public.ai_token_orders, public.ai_token_ledger to service_role;

-- reserve_unlimited_ai plus the paid-model hold, in one transaction: still one round trip.
create or replace function public.reserve_ai_with_tokens(
  p_id uuid, p_uid text, p_day date, p_minute bigint, p_tokens bigint, p_cost bigint,
  p_requests_limit bigint, p_tokens_limit bigint, p_cost_limit bigint, p_rpm bigint,
  p_now bigint, p_credits bigint, p_session_limit bigint, p_weekly_limit bigint, p_session_ms bigint, p_metered boolean,
  p_paid boolean, p_free_weekly bigint
) returns text language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  w public.ai_credit_windows%rowtype;
  b public.ai_token_balances%rowtype;
  free_left bigint; free_hold bigint := 0; paid_hold bigint := 0; result text;
begin
  if p_paid then
    if p_free_weekly < 0 or p_tokens < 0 then raise exception 'Invalid paid hold'; end if;
    -- One account's paid holds take turns, so two requests never both spend the same token.
    perform pg_advisory_xact_lock(hashtext('ai_tokens:' || p_uid));
    select * into w from public.ai_credit_windows where uid = p_uid and kind = 'paid_week' for update;
    if not found or w.ends_at <= p_now then
      w.uid := p_uid; w.kind := 'paid_week'; w.started_at := p_now; w.ends_at := p_now + 604800000;
      w.used_millicredits := 0; w.reserved_millicredits := 0;
    end if;
    insert into public.ai_token_balances(uid) values (p_uid) on conflict do nothing;
    select * into b from public.ai_token_balances where uid = p_uid for update;
    free_left := greatest(0, p_free_weekly - w.used_millicredits - w.reserved_millicredits);
    if free_left <= 0 and b.purchased - b.reserved <= 0 then return 'paid-limit'; end if;
    free_hold := least(p_tokens, free_left);
    paid_hold := p_tokens - free_hold;
  end if;
  result := public.reserve_unlimited_ai(p_id, p_uid, p_day, p_minute, p_tokens, p_cost, p_requests_limit, p_tokens_limit, p_cost_limit, p_rpm,
    p_now, p_credits, p_session_limit, p_weekly_limit, p_session_ms, p_metered);
  if result <> 'ok' or not p_paid then return result; end if;
  insert into public.ai_credit_windows as cw (uid, kind, started_at, ends_at, used_millicredits, reserved_millicredits)
    values (p_uid, 'paid_week', w.started_at, w.ends_at, w.used_millicredits, w.reserved_millicredits + free_hold)
    on conflict (uid, kind) do update set started_at = excluded.started_at, ends_at = excluded.ends_at,
      used_millicredits = excluded.used_millicredits, reserved_millicredits = excluded.reserved_millicredits;
  update public.ai_token_balances set reserved = reserved + paid_hold, updated_at = p_now where uid = p_uid;
  update public.tagflow_reservations set free_tokens = free_hold, paid_tokens = paid_hold, paid_week_started_at = w.started_at where id = p_id;
  return 'ok';
end
$$;

-- Same signature as before; token holds settle free first, then purchased (paidTokens.ts chargeTokens).
-- Failed writes leave the reservation in place: uncertainty must not create free credit.
create or replace function public.settle_included_ai(
  p_id uuid, p_input bigint, p_output bigint, p_cost bigint, p_credits bigint, p_estimated boolean, p_failed boolean
) returns void language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare r public.tagflow_reservations%rowtype; used_tokens bigint; free_charge bigint; paid_charge bigint;
begin
  if least(p_input, p_output, p_cost, p_credits) < 0 or (p_failed and (p_input <> 0 or p_output <> 0 or p_cost <> 0 or p_credits <> 0)) then
    raise exception 'Invalid settlement';
  end if;
  select * into r from public.tagflow_reservations where id = p_id for update;
  if not found or r.settled then return; end if;
  update public.tagflow_usage set requests = requests - case when p_failed then 1 else 0 end,
    input_tokens = input_tokens + p_input, output_tokens = output_tokens + p_output,
    cost_micros = cost_micros + p_cost,
    estimated_requests = estimated_requests + case when p_estimated and not p_failed then 1 else 0 end,
    reserved_tokens = reserved_tokens - r.tokens, reserved_cost_micros = reserved_cost_micros - r.cost_micros
    where uid = r.uid and day = r.day;
  -- Only the windows this request was held in; a window that has since restarted is left alone.
  update public.ai_credit_windows set
      reserved_millicredits = greatest(0, reserved_millicredits - r.millicredits),
      used_millicredits = used_millicredits + p_credits
    where uid = r.uid and ((kind = 'session' and started_at = r.session_started_at) or (kind = 'week' and started_at = r.week_started_at));
  if r.free_tokens > 0 or r.paid_tokens > 0 then
    used_tokens := p_input + p_output;
    free_charge := least(used_tokens, r.free_tokens);
    paid_charge := used_tokens - free_charge;
    update public.ai_credit_windows set
        reserved_millicredits = greatest(0, reserved_millicredits - r.free_tokens),
        used_millicredits = used_millicredits + free_charge
      where uid = r.uid and kind = 'paid_week' and started_at = r.paid_week_started_at;
    update public.ai_token_balances set purchased = purchased - paid_charge, reserved = greatest(0, reserved - r.paid_tokens)
      where uid = r.uid;
    if paid_charge > 0 then
      insert into public.ai_token_ledger(uid, delta, kind, ref, created_at)
        values (r.uid, -paid_charge, 'usage', p_id::text, (extract(epoch from clock_timestamp()) * 1000)::bigint);
    end if;
  end if;
  update public.tagflow_reservations set settled = true where id = p_id;
end
$$;

-- A Dodo payment or refund for an AI-token order, applied at most once ('not-ai-tokens' when the
-- order or payment is not one of ours, so the caller can hand it to advertiser credit).
create or replace function public.apply_ai_token_event(
  p_type text, p_webhook text, p_order text, p_payment text, p_session text, p_now bigint
) returns text language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare o public.ai_token_orders%rowtype; back bigint; left_tokens bigint;
begin
  if p_type = 'purchase' then
    select * into o from public.ai_token_orders where order_id = p_order for update;
  elsif p_type = 'refund' then
    select * into o from public.ai_token_orders where provider_payment_id = p_payment for update;
  else
    raise exception 'Invalid token event';
  end if;
  if not found then return 'not-ai-tokens'; end if;
  insert into public.provider_events(webhook_id, event_type, provider_object_id, order_id, status, received_at)
    values (p_webhook, 'ai-token-' || p_type, p_payment, o.order_id, 'applied', p_now)
    on conflict do nothing;
  if not found then return 'duplicate'; end if;
  if p_type = 'purchase' then
    if o.status <> 'pending' then return 'duplicate'; end if;
    update public.ai_token_orders set status = 'paid', provider_payment_id = p_payment, paid_at = p_now,
      checkout_session = coalesce(p_session, checkout_session) where order_id = o.order_id;
    insert into public.ai_token_balances(uid) values (o.uid) on conflict do nothing;
    update public.ai_token_balances set purchased = purchased + o.tokens, updated_at = p_now where uid = o.uid;
    insert into public.ai_token_ledger(uid, delta, kind, ref, created_at) values (o.uid, o.tokens, 'purchase', o.order_id, p_now);
    return 'credited';
  end if;
  if o.status <> 'paid' then return 'duplicate'; end if;
  -- Only what is left of the order comes back; tokens already used stay used.
  select purchased into left_tokens from public.ai_token_balances where uid = o.uid for update;
  back := least(o.tokens, greatest(0, coalesce(left_tokens, 0)));
  update public.ai_token_orders set status = 'refunded' where order_id = o.order_id;
  update public.ai_token_balances set purchased = purchased - back, updated_at = p_now where uid = o.uid;
  if back > 0 then
    insert into public.ai_token_ledger(uid, delta, kind, ref, created_at) values (o.uid, -back, 'refund', o.order_id, p_now);
  end if;
  return 'refunded';
end
$$;

create or replace function public.grant_ai_tokens(p_uid text, p_tokens bigint, p_admin text, p_note text, p_now bigint)
returns void language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_tokens = 0 or length(p_note) > 500 then raise exception 'Invalid grant'; end if;
  insert into public.ai_token_balances(uid) values (p_uid) on conflict do nothing;
  update public.ai_token_balances set purchased = purchased + p_tokens, updated_at = p_now where uid = p_uid;
  insert into public.ai_token_ledger(uid, delta, kind, ref, note, created_at) values (p_uid, p_tokens, 'grant', p_admin, p_note, p_now);
end
$$;

create or replace function public.ai_token_sales(p_since bigint)
returns table(day date, orders bigint, revenue_cents bigint, tokens_sold bigint, tokens_used bigint)
language sql stable set search_path = pg_catalog, public, pg_temp as $$
  with sold as (
    select (to_timestamp(paid_at / 1000.0) at time zone 'UTC')::date d, count(*) n, sum(price_cents)::bigint cents, sum(tokens)::bigint t
    from public.ai_token_orders where status in ('paid', 'refunded') and paid_at >= p_since group by 1
  ), used as (
    select (to_timestamp(created_at / 1000.0) at time zone 'UTC')::date d, (-sum(delta))::bigint t
    from public.ai_token_ledger where kind = 'usage' and created_at >= p_since group by 1
  )
  select coalesce(sold.d, used.d), coalesce(sold.n, 0), coalesce(sold.cents, 0), coalesce(sold.t, 0), coalesce(used.t, 0)
  from sold full join used on sold.d = used.d order by 1 desc
$$;

revoke all on function public.reserve_ai_with_tokens(uuid,text,date,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,boolean,boolean,bigint) from public, anon, authenticated;
revoke all on function public.settle_included_ai(uuid,bigint,bigint,bigint,bigint,boolean,boolean) from public, anon, authenticated;
revoke all on function public.apply_ai_token_event(text,text,text,text,text,bigint) from public, anon, authenticated;
revoke all on function public.grant_ai_tokens(text,bigint,text,text,bigint) from public, anon, authenticated;
revoke all on function public.ai_token_sales(bigint) from public, anon, authenticated;
grant execute on function public.reserve_ai_with_tokens(uuid,text,date,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,boolean,boolean,bigint) to service_role;
grant execute on function public.settle_included_ai(uuid,bigint,bigint,bigint,bigint,boolean,boolean) to service_role;
grant execute on function public.apply_ai_token_event(text,text,text,text,text,bigint) to service_role;
grant execute on function public.grant_ai_tokens(text,bigint,text,text,bigint) to service_role;
grant execute on function public.ai_token_sales(bigint) to service_role;

commit;
