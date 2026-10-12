begin;
create table public.ai_model_report_collection (
  id integer primary key check (id=1), started_at bigint not null
);
insert into public.ai_model_report_collection values (1,(extract(epoch from now())*1000)::bigint);

create table public.ai_model_requests (
  id uuid primary key, uid text not null,
  model_id text not null check(length(model_id) between 1 and 200), model_name text not null,
  provider text not null check(provider in ('tagflow','openai','google','groq','openrouter')),
  upstream_model text not null, started_at bigint not null,
  finished_at bigint, provider_started_at bigint,
  outcome text not null check(outcome in ('pending','success','provider_error','relay_error','rejected','cancelled')),
  error_code text check(error_code ~ '^[a-z0-9-]{1,80}$'), upstream_status integer check(upstream_status between 100 and 599),
  source text not null check(source in ('chat','agent','completion','edit','admin-test','unknown')),
  streamed boolean not null, tools_offered boolean not null,
  tool_calls integer not null default 0 check(tool_calls>=0), finish_reason text,
  context_window bigint not null check(context_window>0), requested_output bigint not null check(requested_output>=0),
  estimated_input bigint not null check(estimated_input>=0), input_tokens bigint not null default 0 check(input_tokens>=0),
  output_tokens bigint not null default 0 check(output_tokens>=0), cost_micros bigint not null default 0 check(cost_micros>=0),
  estimated boolean not null default false, duration_ms bigint check(duration_ms>=0), first_token_ms bigint check(first_token_ms>=0)
);
create index ai_model_requests_period on public.ai_model_requests(started_at);
create index ai_model_requests_model_period on public.ai_model_requests(provider,model_id,upstream_model,started_at);
create index ai_model_requests_model_user on public.ai_model_requests(provider,model_id,upstream_model,uid,started_at) where source<>'admin-test';

create table public.ai_model_feedback (
  request_id uuid primary key references public.ai_model_requests(id) on delete cascade,
  uid text not null, rating text not null check(rating in ('helpful','not-helpful')),
  category text not null check(category in ('quality','instructions','tools','speed','reliability','other')),
  comment text not null default '' check(length(comment)<=2000), share_with_provider boolean not null default false,
  created_at bigint not null, updated_at bigint not null
);
create index ai_model_feedback_period on public.ai_model_feedback(created_at);
alter table public.ai_model_report_collection enable row level security;
alter table public.ai_model_requests enable row level security;
alter table public.ai_model_feedback enable row level security;
revoke all on public.ai_model_report_collection,public.ai_model_requests,public.ai_model_feedback from public,anon,authenticated;
grant all on public.ai_model_report_collection,public.ai_model_requests,public.ai_model_feedback to service_role;

-- Only the server role can call these invoker functions. No user data leaves the aggregation.
create function public.ai_model_period_metrics(p_provider text,p_model text,p_upstream text,p_from bigint,p_to bigint)
returns jsonb language sql stable set search_path=public as $$
with r as materialized (
  select * from public.ai_model_requests where provider=p_provider and model_id=p_model and upstream_model=p_upstream
    and source<>'admin-test' and started_at>=p_from and started_at<p_to
), user_counts as (select uid,count(*) as attempts from r group by uid),
first_seen as (
  select u.uid,(select min(first.started_at) from public.ai_model_requests first where first.provider=p_provider
    and first.model_id=p_model and first.upstream_model=p_upstream and first.uid=u.uid and first.source<>'admin-test') as first_at
  from user_counts u
), minutes as (
  select floor(provider_started_at/60000.0) as minute,count(*) as requests,sum(input_tokens+output_tokens) as tokens
  from r where provider_started_at is not null group by 1
), intervals as (
  select provider_started_at as start_at,coalesce(finished_at,least(p_to,provider_started_at+180000)) as end_at from r where provider_started_at is not null
), deltas as (
  select at,sum(delta) as delta from (
    select start_at as at,1 as delta from intervals where end_at>start_at
    union all select end_at as at,-1 as delta from intervals where end_at>start_at
  ) events group by at
), concurrent as (select sum(delta) over(order by at) as active from deltas),
throughput as (
  select output_tokens*1000.0/(duration_ms-first_token_ms) as tps from r where outcome='success' and not estimated
    and output_tokens>0 and first_token_ms is not null and duration_ms>first_token_ms
), feedback as (
  select f.* from public.ai_model_feedback f join public.ai_model_requests q on q.id=f.request_id
  where q.provider=p_provider and q.model_id=p_model and q.upstream_model=p_upstream and q.source<>'admin-test'
    and f.created_at>=p_from and f.created_at<p_to
)
select jsonb_build_object(
    'attempts', count(*) filter (where true),
    'providerCalls', count(*) filter (where provider_started_at is not null),
    'successes', count(*) filter (where outcome='success'),
    'providerErrors', count(*) filter (where outcome='provider_error'),
    'relayErrors', count(*) filter (where outcome='relay_error'),
    'rejected', count(*) filter (where outcome='rejected'),
    'cancelled', count(*) filter (where outcome='cancelled'),
    'unfinished', count(*) filter (where outcome='pending'),
    'activeUsers', (select count(*) from user_counts),
    'repeatUsers', (select count(*) from user_counts where attempts>=2),
    'newUsers', (select count(*) from first_seen where first_at>=p_from),
    'returningUsers', (select count(*) from first_seen where first_at<p_from),
    'inputTokens', coalesce(sum(input_tokens),0),
    'outputTokens', coalesce(sum(output_tokens),0),
    'costMicros', coalesce(sum(cost_micros),0),
    'estimatedRequests', count(*) filter (where provider_started_at is not null and estimated and outcome<>'pending'),
    'toolRequests', count(*) filter (where provider_started_at is not null and tools_offered),
    'toolCalls', coalesce(sum(tool_calls),0),
    'streamedRequests', count(*) filter (where provider_started_at is not null and streamed),
    'outputLimitStops', count(*) filter (where outcome='success' and finish_reason='length'),
    'refusals', count(*) filter (where outcome='success' and finish_reason='refusal'),
    'peakRpm', (select coalesce(max(requests),0) from minutes),
    'peakTpm', (select coalesce(max(tokens),0) from minutes),
    'peakConcurrency', (select coalesce(max(active),0) from concurrent),
    'latencySamples', count(*) filter (where outcome='success' and duration_ms is not null),
    'firstTokenSamples', count(*) filter (where outcome='success' and first_token_ms is not null),
    'throughputSamples', (select count(*) from throughput),
    'durationP50', percentile_cont(0.5) within group (order by duration_ms) filter (where outcome='success'),
    'durationP95', percentile_cont(0.95) within group (order by duration_ms) filter (where outcome='success'),
    'firstTokenP50', percentile_cont(0.5) within group (order by first_token_ms) filter (where outcome='success'),
    'firstTokenP95', percentile_cont(0.95) within group (order by first_token_ms) filter (where outcome='success'),
    'inputP50', percentile_cont(0.5) within group (order by input_tokens) filter (where outcome='success'),
    'inputP95', percentile_cont(0.95) within group (order by input_tokens) filter (where outcome='success'),
    'outputP50', percentile_cont(0.5) within group (order by output_tokens) filter (where outcome='success'),
    'outputP95', percentile_cont(0.95) within group (order by output_tokens) filter (where outcome='success'),
    'outputTpsP50', (select percentile_cont(0.5) within group(order by tps) from throughput),
    'outputTpsP95', (select percentile_cont(0.95) within group(order by tps) from throughput),
    'helpful', (select count(*) from feedback where rating='helpful'),
    'notHelpful', (select count(*) from feedback where rating='not-helpful'),
    'feedbackUsers', (select count(distinct uid) from feedback)
) from r;
$$;

create function public.read_ai_model_reports(p_from bigint,p_to bigint,p_previous_from bigint)
returns jsonb language sql stable set search_path=public as $$
with requests as materialized (
  select * from public.ai_model_requests where source<>'admin-test' and started_at>=p_previous_from and started_at<p_to
), feedback as materialized (
  select f.*,q.provider,q.model_id,q.upstream_model,q.model_name from public.ai_model_feedback f
  join public.ai_model_requests q on q.id=f.request_id
  where q.source<>'admin-test' and f.created_at>=p_previous_from and f.created_at<p_to
), models as (
  select provider,model_id,upstream_model,(array_agg(model_name order by at desc))[1] as model_name from (
    select provider,model_id,upstream_model,model_name,started_at as at from requests
    union all select provider,model_id,upstream_model,model_name,created_at as at from feedback
  ) identities group by provider,model_id,upstream_model
), reports as (
  select jsonb_build_object(
    'modelId',m.model_id,'modelName',m.model_name,'provider',m.provider,'upstreamModel',m.upstream_model,
    'current',public.ai_model_period_metrics(m.provider,m.model_id,m.upstream_model,p_from,p_to),
    'previous',public.ai_model_period_metrics(m.provider,m.model_id,m.upstream_model,p_previous_from,p_from),
    'daily',coalesce((
      with days as (
        select to_char(day,'YYYY-MM-DD') as day from generate_series(
          (to_timestamp(p_from/1000.0) at time zone 'UTC')::date,
          (to_timestamp((p_to-1)/1000.0) at time zone 'UTC')::date,interval '1 day') day
      ), q as (
        select to_char(to_timestamp(started_at/1000.0) at time zone 'UTC','YYYY-MM-DD') as day,count(*) as attempts,
          count(*) filter(where outcome='success') as successes,count(*) filter(where outcome='provider_error') as provider_errors,
          count(*) filter(where outcome='rejected') as rejected,count(distinct uid) as users,sum(input_tokens) as input_tokens,sum(output_tokens) as output_tokens
        from requests where provider=m.provider and model_id=m.model_id and upstream_model=m.upstream_model and started_at>=p_from group by 1
      ), f as (
        select to_char(to_timestamp(created_at/1000.0) at time zone 'UTC','YYYY-MM-DD') as day,
          count(*) filter(where rating='helpful') as helpful,count(*) filter(where rating='not-helpful') as not_helpful
        from feedback where provider=m.provider and model_id=m.model_id and upstream_model=m.upstream_model and created_at>=p_from group by 1
      )
      select jsonb_agg(jsonb_build_object('day',days.day,'attempts',coalesce(q.attempts,0),'successes',coalesce(q.successes,0),
        'providerErrors',coalesce(q.provider_errors,0),'rejected',coalesce(q.rejected,0),'activeUsers',coalesce(q.users,0),
        'inputTokens',coalesce(q.input_tokens,0),'outputTokens',coalesce(q.output_tokens,0),'helpful',coalesce(f.helpful,0),'notHelpful',coalesce(f.not_helpful,0)) order by days.day)
      from days left join q using(day) left join f using(day)
    ),'[]'::jsonb),
    'errors',coalesce((select jsonb_agg(value order by occurrences desc) from (
      select count(*) as occurrences,jsonb_build_object('outcome',outcome,'code',error_code,'upstreamStatus',upstream_status,
        'count',count(*),'firstAt',min(started_at),'lastAt',max(started_at)) as value
      from requests where provider=m.provider and model_id=m.model_id and upstream_model=m.upstream_model and started_at>=p_from and error_code is not null
      group by outcome,error_code,upstream_status
    ) errors),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(jsonb_build_object('source',source,'requests',requests)) from (
      select source,count(*) as requests from requests where provider=m.provider and model_id=m.model_id and upstream_model=m.upstream_model and started_at>=p_from group by source
    ) sources),'[]'::jsonb),
    'hourly',coalesce((select jsonb_agg(jsonb_build_object('hour',hour,'requests',requests) order by hour) from (
      select extract(hour from to_timestamp(provider_started_at/1000.0) at time zone 'UTC')::integer as hour,count(*) as requests
      from requests where provider=m.provider and model_id=m.model_id and upstream_model=m.upstream_model and started_at>=p_from and provider_started_at is not null group by 1
    ) hours),'[]'::jsonb),
    'inputBands',coalesce((select jsonb_agg(jsonb_build_object('band',band,'requests',requests)) from (
      select case when input_tokens<8192 then '<8k' when input_tokens<32768 then '8k–32k' when input_tokens<65536 then '32k–64k'
        when input_tokens<131072 then '64k–128k' else '128k+' end as band,count(*) as requests
      from requests where provider=m.provider and model_id=m.model_id and upstream_model=m.upstream_model and started_at>=p_from and outcome='success' group by 1
    ) bands),'[]'::jsonb),
    'feedbackCategories',coalesce((select jsonb_agg(jsonb_build_object('category',category,'helpful',helpful,'notHelpful',not_helpful)) from (
      select category,count(*) filter(where rating='helpful') as helpful,count(*) filter(where rating='not-helpful') as not_helpful
      from feedback where provider=m.provider and model_id=m.model_id and upstream_model=m.upstream_model and created_at>=p_from group by category
    ) categories),'[]'::jsonb),
    'sharedComments',coalesce((select jsonb_agg(jsonb_build_object('at',created_at,'rating',rating,'category',category,'comment',comment) order by created_at desc) from (
      select * from feedback where provider=m.provider and model_id=m.model_id and upstream_model=m.upstream_model
        and created_at>=p_from and share_with_provider and length(trim(comment))>0 order by created_at desc limit 50
    ) comments),'[]'::jsonb),
    'sharedCommentCount',(select count(*) from feedback where provider=m.provider and model_id=m.model_id and upstream_model=m.upstream_model
      and created_at>=p_from and share_with_provider and length(trim(comment))>0)
  ) as report from models m
)
select jsonb_build_object('collectionStartedAt',(select started_at from public.ai_model_report_collection where id=1),
  'models',coalesce((select jsonb_agg(report) from reports),'[]'::jsonb));
$$;
revoke all on function public.ai_model_period_metrics(text,text,text,bigint,bigint) from public,anon,authenticated;
revoke all on function public.read_ai_model_reports(bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.ai_model_period_metrics(text,text,text,bigint,bigint),public.read_ai_model_reports(bigint,bigint,bigint) to service_role;
commit;
