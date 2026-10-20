-- The public status page: a human-written incident log, alongside the model health the
-- page derives from `model_outcomes`. Rules: services/api/src/status.ts.
--
-- Two tables, and the incident's `status` column mirrors its newest update so the banner
-- can be read without joining. Both writes a person can make (open an incident, add an
-- update) are single functions, because an incident whose update failed to land would
-- tell people a story that stops halfway.
begin;

create table public.status_incidents (
  incident_id text primary key,
  title text not null,
  impact text not null check (impact in ('none', 'minor', 'major', 'critical', 'maintenance')),
  status text not null check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  author_uid text not null,
  created_at bigint not null,
  updated_at bigint not null,
  resolved_at bigint
);
alter table public.status_incidents enable row level security;
revoke all on public.status_incidents from public, anon, authenticated;
grant all on public.status_incidents to service_role;
create index if not exists status_incidents_recent_idx on public.status_incidents (created_at desc);

create table public.status_incident_updates (
  update_id text primary key,
  incident_id text not null references public.status_incidents (incident_id),
  status text not null check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  body text not null,
  author_uid text not null,
  created_at bigint not null
);
alter table public.status_incident_updates enable row level security;
revoke all on public.status_incident_updates from public, anon, authenticated;
grant all on public.status_incident_updates to service_role;
create index if not exists status_incident_updates_incident_idx on public.status_incident_updates (incident_id, created_at);

-- Opens an incident and its first update in one transaction.
create or replace function public.status_create_incident(
  p_incident_id text, p_update_id text, p_title text, p_impact text, p_status text, p_body text, p_author_uid text, p_at bigint
) returns void language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  insert into public.status_incidents(incident_id, title, impact, status, author_uid, created_at, updated_at, resolved_at)
    values (p_incident_id, p_title, p_impact, p_status, p_author_uid, p_at, p_at,
      case when p_status = 'resolved' then p_at end);
  insert into public.status_incident_updates(update_id, incident_id, status, body, author_uid, created_at)
    values (p_update_id, p_incident_id, p_status, p_body, p_author_uid, p_at);
end
$$;

-- Adds one update and moves the incident's headline status in the same transaction.
-- Reopening a resolved incident (any status but resolved) clears the resolution time.
create or replace function public.status_add_incident_update(
  p_incident_id text, p_update_id text, p_status text, p_body text, p_author_uid text, p_at bigint
) returns boolean language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  update public.status_incidents
    set status = p_status, updated_at = p_at,
      resolved_at = case when p_status = 'resolved' then p_at end
    where incident_id = p_incident_id;
  if not found then return false; end if;
  insert into public.status_incident_updates(update_id, incident_id, status, body, author_uid, created_at)
    values (p_update_id, p_incident_id, p_status, p_body, p_author_uid, p_at);
  return true;
end
$$;

revoke all on function public.status_create_incident(text,text,text,text,text,text,text,bigint) from public, anon, authenticated;
revoke all on function public.status_add_incident_update(text,text,text,text,text,bigint) from public, anon, authenticated;
grant execute on function public.status_create_incident(text,text,text,text,text,text,text,bigint) to service_role;
grant execute on function public.status_add_incident_update(text,text,text,text,text,bigint) to service_role;

commit;
