-- Relay measurements keep every platform on the same clock. Client daily summaries cannot
-- describe a two-hour interval, and must never be split into invented intraday candles.
create or replace function public.read_model_status_buckets(p_from bigint, p_to bigint)
returns jsonb language sql stable security invoker set search_path = public as $$
with measured as (
  select model_id,
    (started_at / 7200000) * 7200000 as bucket,
    started_at,
    case when outcome = 'success' then 'ok' else 'error' end as result,
    case when outcome = 'success' then coalesce(duration_ms, 0) else 0 end as ms
  from public.ai_model_requests
  where started_at >= greatest(p_from, p_to - 604800000) and started_at < p_to
    and source <> 'admin-test'
    and (outcome in ('success', 'provider_error', 'relay_error')
      or (outcome = 'rejected' and error_code = 'model-busy'))
), buckets as (
  select model_id, bucket, result, count(*) as requests, sum(ms) as total_ms,
    count(*) filter (where started_at >= p_to - 900000) as recent_count
  from measured group by model_id, bucket, result
)
select coalesce(jsonb_agg(jsonb_build_object(
  'startAt', bucket, 'model', model_id, 'outcome', result,
  'count', requests, 'totalMs', total_ms, 'recentCount', recent_count
) order by model_id, bucket, result), '[]'::jsonb) from buckets;
$$;

revoke all on function public.read_model_status_buckets(bigint, bigint) from public, anon, authenticated;
grant execute on function public.read_model_status_buckets(bigint, bigint) to service_role;
