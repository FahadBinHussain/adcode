-- ADCode authenticates Firebase users in its API and calls these RPCs with service_role.
-- Direct anon/authenticated callers must never bypass the API's ownership/admin checks.
-- https://supabase.com/docs/guides/database/functions#function-privileges
do $$
declare
  fn record;
begin
  for fn in
    select p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke execute on function %I.%I(%s) from public, anon, authenticated', fn.nspname, fn.proname, fn.args);
    execute format('grant execute on function %I.%I(%s) to service_role', fn.nspname, fn.proname, fn.args);
    -- Preserve unqualified application table names while excluding caller-controlled search paths.
    execute format('alter function %I.%I(%s) set search_path = pg_catalog, public, pg_temp', fn.nspname, fn.proname, fn.args);
  end loop;
end;
$$;

-- Functions created by subsequent application migrations are server-only by default.
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
