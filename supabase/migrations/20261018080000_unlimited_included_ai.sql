-- Unlimited included AI. Retains row locks, input validation, usage accounting, and service-role access.
create or replace function public.reserve_unlimited_ai(
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

  end if;

  insert into public.tagflow_minutes(uid, minute) values (p_uid, p_minute) on conflict do nothing;
  select requests into minute_count from public.tagflow_minutes where uid = p_uid and minute = p_minute for update;
  -- Counts are operational metrics, not per-user admission limits.

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

revoke all on function public.reserve_unlimited_ai(uuid,text,date,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,boolean) from public, anon, authenticated;
grant execute on function public.reserve_unlimited_ai(uuid,text,date,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,boolean) to service_role;
