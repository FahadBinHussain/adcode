begin;

-- Provider owner confirmed Tagflow Code 27B supports 256k. Preserve larger/custom windows.
update public.tagflow_config set
  config = jsonb_set(jsonb_set(config,'{models}',(
    select jsonb_agg(case when model->>'id'='tagflow-code-27b'
      and coalesce(model->>'provider','tagflow')='tagflow'
      then jsonb_set(model,'{contextWindow}',to_jsonb(greatest((model->>'contextWindow')::bigint,262144)),false)
      else model end order by position)
    from jsonb_array_elements(config->'models') with ordinality as offered(model,position)
  ),false),'{maxInputTokens}',to_jsonb(greatest((config->>'maxInputTokens')::bigint,262144)),false),
  updated_at=(extract(epoch from now())*1000)::bigint,updated_by='migration:tagflow-256k-audience'
where id=1 and exists (select 1 from jsonb_array_elements(config->'models') as offered(model)
  where model->>'id'='tagflow-code-27b' and coalesce(model->>'provider','tagflow')='tagflow');

alter table public.ai_model_report_collection add column audience_started_at bigint not null default (extract(epoch from now())*1000)::bigint;
alter table public.ai_model_requests
  add column country text not null default 'unknown' check(country='unknown' or (country ~ '^[A-Z]{2}$' and country<>'XX')),
  add column ai_persona text not null default 'unknown' check(ai_persona in ('unknown','coding-assistant','reviewer','tester','ui-polish','bug-fixer','docs-writer','custom-agent','inline-assistant')),
  add column use_case text not null default 'unknown' check(use_case in ('unknown','coding-assistance','code-completion','code-editing','code-review','testing','ui-design','debugging','documentation','agent-workflow')),
  add column platform text not null default 'unknown' check(platform in ('unknown','win32','darwin','linux'));

-- A present row means the account deliberately opted into aggregate provider reporting.
-- Report-time joins make withdrawal immediate, including for historical requests.
create table public.ai_model_audience_profiles (
  uid text primary key,
  role text not null check(role in ('unknown','student','hobbyist','professional-developer','founder','designer','researcher','other')),
  experience text not null check(experience in ('unknown','beginner','intermediate','advanced')),
  primary_use text not null check(primary_use in ('unknown','build-product','debugging','testing','code-review','learning','documentation','ui-design','other')),
  updated_at bigint not null
);
alter table public.ai_model_audience_profiles enable row level security;
revoke all on public.ai_model_audience_profiles from public,anon,authenticated;
grant all on public.ai_model_audience_profiles to service_role;

create function public.ai_model_audience_metrics(p_provider text,p_model text,p_upstream text,p_from bigint,p_to bigint,p_previous_from bigint)
returns jsonb language sql stable security invoker set search_path=public as $$
with requests as materialized (
  select r.*,p.role,p.experience,p.primary_use from public.ai_model_requests r
  left join public.ai_model_audience_profiles p on p.uid=r.uid
  where r.provider=p_provider and r.model_id=p_model and r.upstream_model=p_upstream
    and r.source<>'admin-test' and r.started_at>=p_previous_from and r.started_at<p_to
), segments as (
  select dimensions.dimension,dimensions.value,
    count(*) filter(where r.started_at>=p_from) as requests,
    count(distinct r.uid) filter(where r.started_at>=p_from) as users,
    count(*) filter(where r.started_at>=p_from and r.outcome='success') as successes,
    count(*) filter(where r.started_at>=p_from and r.outcome='provider_error') as errors,
    coalesce(sum(r.input_tokens) filter(where r.started_at>=p_from),0) as input_tokens,
    coalesce(sum(r.output_tokens) filter(where r.started_at>=p_from),0) as output_tokens,
    count(*) filter(where r.started_at<p_from) as previous_requests,
    count(distinct r.uid) filter(where r.started_at<p_from) as previous_users
  from requests r cross join lateral (values
    ('countries',r.country),('userRoles',coalesce(r.role,'unknown')),('experienceLevels',coalesce(r.experience,'unknown')),
    ('aiPersonas',r.ai_persona),('useCases',r.use_case),('declaredUses',coalesce(r.primary_use,'unknown')),('platforms',r.platform)
  ) as dimensions(dimension,value) group by dimensions.dimension,dimensions.value
), dimensions as (
  select dimension,jsonb_agg(jsonb_build_object('value',value,'requests',requests,'activeUsers',users,'successes',successes,
    'providerErrors',errors,'inputTokens',input_tokens,'outputTokens',output_tokens,'previousRequests',previous_requests,'previousActiveUsers',previous_users)
    order by requests desc,value) as segments from segments group by dimension
), bands as (
  select case when input_tokens<8192 then '<8k' when input_tokens<32768 then '8k–32k' when input_tokens<65536 then '32k–64k'
    when input_tokens<131072 then '64k–128k' when input_tokens<262144 then '128k–256k' else '256k+' end as band,count(*) as requests
  from requests where started_at>=p_from and outcome='success' group by 1
)
select jsonb_build_object('audience',coalesce((select jsonb_object_agg(dimension,segments) from dimensions),'{}'::jsonb),
  'inputBands',coalesce((select jsonb_agg(jsonb_build_object('band',band,'requests',requests)) from bands),'[]'::jsonb));
$$;

-- Preserve the original RPC for older deployments during rollout.
create function public.read_ai_model_reports_v2(p_from bigint,p_to bigint,p_previous_from bigint)
returns jsonb language sql stable security invoker set search_path=public as $$
with base as (select public.read_ai_model_reports(p_from,p_to,p_previous_from) as report)
select report || jsonb_build_object('audienceStartedAt',(select audience_started_at from public.ai_model_report_collection where id=1),
  'models',coalesce((select jsonb_agg(model || public.ai_model_audience_metrics(model->>'provider',model->>'modelId',model->>'upstreamModel',p_from,p_to,p_previous_from))
    from jsonb_array_elements(report->'models') as models(model)),'[]'::jsonb)) from base;
$$;
revoke all on function public.ai_model_audience_metrics(text,text,text,bigint,bigint,bigint),public.read_ai_model_reports_v2(bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.ai_model_audience_metrics(text,text,text,bigint,bigint,bigint),public.read_ai_model_reports_v2(bigint,bigint,bigint) to service_role;
commit;
