-- Free AI credits: one balance for every included model, on a rolling session window (5 hours
-- by default) and a rolling 7-day window, as in a Claude Max plan. Rules: services/api/src/credits.ts.
-- Additive: the deployed relay keeps using reserve_tagflow_usage until the new one replaces it.
begin;

create table public.ai_credit_windows (
  uid text not null,
  kind text not null check (kind in ('session', 'week')),
  started_at bigint not null,
  ends_at bigint not null check (ends_at > started_at),
  used_millicredits bigint not null default 0 check (used_millicredits >= 0),
  reserved_millicredits bigint not null default 0 check (reserved_millicredits >= 0),
  primary key (uid, kind)
);
alter table public.ai_credit_windows enable row level security;
revoke all on public.ai_credit_windows from anon, authenticated;
grant all on public.ai_credit_windows to service_role;

-- Which windows a reservation was held in, so a late settlement never lands in a newer window.
alter table public.tagflow_reservations
  add column millicredits bigint not null default 0 check (millicredits >= 0),
  add column session_started_at bigint,
  add column week_started_at bigint;

-- One transaction: the day's ceilings (spend, requests), then credits, then the per-minute cap.
-- A request starts while its windows have any credit left; it is charged what it really used.
create or replace function public.reserve_included_ai(
  p_id uuid, p_uid text, p_day date, p_minute bigint, p_tokens bigint, p_cost bigint,
  p_requests_limit bigint, p_tokens_limit bigint, p_cost_limit bigint, p_rpm bigint,
  p_now bigint, p_credits bigint, p_session_limit bigint, p_weekly_limit bigint, p_session_ms bigint, p_metered boolean
) returns text language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  u public.tagflow_usage%rowtype;
  s public.ai_credit_windows%rowtype;
  w public.ai_credit_windows%rowtype;
  minute_count bigint;
begin
  if least(p_tokens, p_cost, p_requests_limit, p_tokens_limit, p_cost_limit, p_rpm, p_now, p_credits, p_session_limit, p_weekly_limit, p_session_ms) < 0 then
    raise exception 'Invalid allowance';
  end if;
  insert into public.tagflow_usage(uid, day) values (p_uid, p_day) on conflict do nothing;
  select * into u from public.tagflow_usage where uid = p_uid and day = p_day for update;
  if (p_requests_limit <> 1000000 and u.requests + 1 > p_requests_limit) or
      u.input_tokens + u.output_tokens + u.reserved_tokens + p_tokens > p_tokens_limit or
      u.cost_micros + u.reserved_cost_micros + p_cost > p_cost_limit then return 'daily-limit'; end if;

  if p_metered then
    if p_session_ms < 3600000 then raise exception 'Invalid session window'; end if;
    -- One account's reservations take turns, including the very first, before any row exists.
    perform pg_advisory_xact_lock(hashtext('ai_credit_windows:' || p_uid));
    -- Lock session before week, so two requests can never wait on each other. A refusal
    -- writes nothing: an ended window is only replaced by the request that is admitted.
    select * into s from public.ai_credit_windows where uid = p_uid and kind = 'session' for update;
    if not found or s.ends_at <= p_now then
      s.started_at := p_now; s.ends_at := p_now + p_session_ms; s.used_millicredits := 0; s.reserved_millicredits := 0;
    end if;
    select * into w from public.ai_credit_windows where uid = p_uid and kind = 'week' for update;
    if not found or w.ends_at <= p_now then
      w.started_at := p_now; w.ends_at := p_now + 604800000; w.used_millicredits := 0; w.reserved_millicredits := 0;
    end if;
    if p_credits > 0 then
      if w.used_millicredits + w.reserved_millicredits >= p_weekly_limit then return 'weekly-limit'; end if;
      if s.used_millicredits + s.reserved_millicredits >= p_session_limit then return 'session-limit'; end if;
    end if;
  end if;

  insert into public.tagflow_minutes(uid, minute) values (p_uid, p_minute) on conflict do nothing;
  select requests into minute_count from public.tagflow_minutes where uid = p_uid and minute = p_minute for update;
  if p_rpm <> 1000 and minute_count >= p_rpm then return 'rate-limit'; end if;

  insert into public.tagflow_reservations(id, uid, day, tokens, cost_micros, millicredits, session_started_at, week_started_at)
    values (p_id, p_uid, p_day, p_tokens, p_cost, case when p_metered then p_credits else 0 end,
      case when p_metered then s.started_at end, case when p_metered then w.started_at end);
  update public.tagflow_usage set requests = requests + 1, reserved_tokens = reserved_tokens + p_tokens,
    reserved_cost_micros = reserved_cost_micros + p_cost where uid = p_uid and day = p_day;
  if p_metered then
    -- Opens a window, replaces an ended one, or adds this request's hold to the current one.
    insert into public.ai_credit_windows as cw (uid, kind, started_at, ends_at, used_millicredits, reserved_millicredits)
      values (p_uid, 'session', s.started_at, s.ends_at, 0, p_credits), (p_uid, 'week', w.started_at, w.ends_at, 0, p_credits)
      on conflict (uid, kind) do update set
        used_millicredits = case when cw.started_at = excluded.started_at then cw.used_millicredits else 0 end,
        reserved_millicredits = case when cw.started_at = excluded.started_at then cw.reserved_millicredits else 0 end + excluded.reserved_millicredits,
        started_at = excluded.started_at, ends_at = excluded.ends_at;
  end if;
  update public.tagflow_minutes set requests = requests + 1 where uid = p_uid and minute = p_minute;
  return 'ok';
end
$$;

-- Failed writes leave the reservation in place: uncertainty must not create free credit.
create or replace function public.settle_included_ai(
  p_id uuid, p_input bigint, p_output bigint, p_cost bigint, p_credits bigint, p_estimated boolean, p_failed boolean
) returns void language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare r public.tagflow_reservations%rowtype;
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
  update public.tagflow_reservations set settled = true where id = p_id;
end
$$;

revoke all on function public.reserve_included_ai(uuid,text,date,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,boolean) from public, anon, authenticated;
revoke all on function public.settle_included_ai(uuid,bigint,bigint,bigint,bigint,boolean,boolean) from public, anon, authenticated;
grant execute on function public.reserve_included_ai(uuid,text,date,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,boolean) to service_role;
grant execute on function public.settle_included_ai(uuid,bigint,bigint,bigint,bigint,boolean,boolean) to service_role;

commit;
