-- Included AI owns separate configuration and count-only accounting tables.
-- No prompts, responses or provider secrets are stored here.
create table public.tagflow_config (
  id integer primary key check (id = 1),
  config jsonb not null,
  updated_at bigint not null,
  updated_by text not null
);
create table public.tagflow_user_policies (
  uid text primary key,
  policy jsonb not null
);
create table public.tagflow_usage (
  uid text not null,
  day date not null,
  requests bigint not null default 0 check (requests >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  estimated_requests bigint not null default 0 check (estimated_requests >= 0),
  reserved_tokens bigint not null default 0 check (reserved_tokens >= 0),
  reserved_cost_micros bigint not null default 0 check (reserved_cost_micros >= 0),
  primary key (uid, day)
);
create index tagflow_usage_day on public.tagflow_usage (day, cost_micros desc);
create table public.tagflow_minutes (
  uid text not null,
  minute bigint not null,
  requests bigint not null default 0,
  primary key (uid, minute)
);
create table public.tagflow_reservations (
  id uuid primary key,
  uid text not null,
  day date not null,
  tokens bigint not null check (tokens >= 0),
  cost_micros bigint not null check (cost_micros >= 0),
  settled boolean not null default false
);
alter table public.tagflow_config enable row level security;
alter table public.tagflow_user_policies enable row level security;
alter table public.tagflow_usage enable row level security;
alter table public.tagflow_minutes enable row level security;
alter table public.tagflow_reservations enable row level security;
revoke all on public.tagflow_config, public.tagflow_user_policies, public.tagflow_usage, public.tagflow_minutes, public.tagflow_reservations from anon, authenticated;
grant all on public.tagflow_config, public.tagflow_user_policies, public.tagflow_usage, public.tagflow_minutes, public.tagflow_reservations to service_role;

-- Row locking prevents two chats, agents or Cloudflare isolates spending one allowance.
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
  if u.requests + 1 > p_requests_limit or
      u.input_tokens + u.output_tokens + u.reserved_tokens + p_tokens > p_tokens_limit or
      u.cost_micros + u.reserved_cost_micros + p_cost > p_cost_limit then return 'daily-limit'; end if;
  insert into public.tagflow_minutes(uid, minute) values (p_uid, p_minute) on conflict do nothing;
  select requests into minute_count from public.tagflow_minutes where uid = p_uid and minute = p_minute for update;
  if minute_count >= p_rpm then return 'rate-limit'; end if;
  insert into public.tagflow_reservations(id, uid, day, tokens, cost_micros) values (p_id, p_uid, p_day, p_tokens, p_cost);
  update public.tagflow_usage set requests = requests + 1, reserved_tokens = reserved_tokens + p_tokens,
    reserved_cost_micros = reserved_cost_micros + p_cost where uid = p_uid and day = p_day;
  update public.tagflow_minutes set requests = requests + 1 where uid = p_uid and minute = p_minute;
  return 'ok';
end
$$;

-- Failed writes leave the reservation in place: uncertainty must not create free credit.
create or replace function public.settle_tagflow_usage(
  p_id uuid, p_input bigint, p_output bigint, p_cost bigint, p_estimated boolean, p_failed boolean
) returns void language plpgsql set search_path = public as $$
declare r public.tagflow_reservations%rowtype;
begin
  if least(p_input, p_output, p_cost) < 0 or (p_failed and (p_input <> 0 or p_output <> 0 or p_cost <> 0)) then
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
  update public.tagflow_reservations set settled = true where id = p_id;
end
$$;
revoke all on function public.reserve_tagflow_usage(uuid,text,date,bigint,bigint,bigint,bigint,bigint,bigint,bigint) from public, anon, authenticated;
revoke all on function public.settle_tagflow_usage(uuid,bigint,bigint,bigint,boolean,boolean) from public, anon, authenticated;
grant execute on function public.reserve_tagflow_usage(uuid,text,date,bigint,bigint,bigint,bigint,bigint,bigint,bigint) to service_role;
grant execute on function public.settle_tagflow_usage(uuid,bigint,bigint,bigint,boolean,boolean) to service_role;
