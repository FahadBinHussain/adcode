begin;

-- Reserved numeric values preserve compatibility with already-deployed relays.
-- Skip request checks entirely for these values; zero still disables requests.
create or replace function public.reserve_tagflow_usage(
  p_id uuid, p_uid text, p_day date, p_minute bigint, p_tokens bigint, p_cost bigint,
  p_requests_limit bigint, p_tokens_limit bigint, p_cost_limit bigint, p_rpm bigint
) returns text language plpgsql set search_path = public as $$
declare u public.tagflow_usage%rowtype; minute_count bigint;
begin
  if least(p_tokens, p_cost, p_requests_limit, p_tokens_limit, p_cost_limit, p_rpm) < 0 then
    raise exception 'Invalid allowance';
  end if;
  insert into public.tagflow_usage(uid, day) values (p_uid, p_day) on conflict do nothing;
  select * into u from public.tagflow_usage where uid = p_uid and day = p_day for update;
  if (p_requests_limit <> 1000000 and u.requests + 1 > p_requests_limit) or
      u.input_tokens + u.output_tokens + u.reserved_tokens + p_tokens > p_tokens_limit or
      u.cost_micros + u.reserved_cost_micros + p_cost > p_cost_limit then return 'daily-limit'; end if;
  insert into public.tagflow_minutes(uid, minute) values (p_uid, p_minute) on conflict do nothing;
  select requests into minute_count from public.tagflow_minutes where uid = p_uid and minute = p_minute for update;
  if p_rpm <> 1000 and minute_count >= p_rpm then return 'rate-limit'; end if;
  insert into public.tagflow_reservations(id, uid, day, tokens, cost_micros) values (p_id, p_uid, p_day, p_tokens, p_cost);
  update public.tagflow_usage set requests = requests + 1, reserved_tokens = reserved_tokens + p_tokens,
    reserved_cost_micros = reserved_cost_micros + p_cost where uid = p_uid and day = p_day;
  update public.tagflow_minutes set requests = requests + 1 where uid = p_uid and minute = p_minute;
  return 'ok';
end
$$;
revoke all on function public.reserve_tagflow_usage(uuid,text,date,bigint,bigint,bigint,bigint,bigint,bigint,bigint) from public, anon, authenticated;
grant execute on function public.reserve_tagflow_usage(uuid,text,date,bigint,bigint,bigint,bigint,bigint,bigint,bigint) to service_role;

update public.tagflow_config
set config = jsonb_set(jsonb_set(jsonb_set(config,
      '{limits,dailyRequests}', case when (config #>> '{limits,dailyRequests}')::bigint > 0 then '1000000'::jsonb else '0'::jsonb end, false),
      '{limits,requestsPerMinute}', case when (config #>> '{limits,requestsPerMinute}')::bigint > 0 then '1000'::jsonb else '0'::jsonb end, false),
      '{maxInputTokens}', to_jsonb(greatest((config ->> 'maxInputTokens')::bigint, 131072)), false),
    updated_at = (extract(epoch from now()) * 1000)::bigint,
    updated_by = 'migration:included-ai-unlimited-requests'
where id = 1 and ((config #>> '{limits,dailyRequests}')::bigint between 1 and 999999
  or (config #>> '{limits,requestsPerMinute}')::bigint between 1 and 999
  or (config ->> 'maxInputTokens')::bigint < 131072);

update public.tagflow_user_policies
set policy = jsonb_set(jsonb_set(jsonb_set(jsonb_set(policy,
      '{limits,dailyRequests}', case when (policy #>> '{limits,dailyRequests}')::bigint > 0 then '1000000'::jsonb else '0'::jsonb end, false),
      '{limits,requestsPerMinute}', case when (policy #>> '{limits,requestsPerMinute}')::bigint > 0 then '1000'::jsonb else '0'::jsonb end, false),
      '{updatedAt}', to_jsonb((extract(epoch from now()) * 1000)::bigint), false),
      '{updatedBy}', '"migration:included-ai-unlimited-requests"'::jsonb, false)
where (policy #>> '{limits,dailyRequests}')::bigint between 1 and 999999
  or (policy #>> '{limits,requestsPerMinute}')::bigint between 1 and 999;

commit;
