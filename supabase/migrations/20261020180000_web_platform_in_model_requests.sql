-- The web version reports its requests as platform 'web' (89865d01), but the column's check
-- only knew the desktop operating systems, so every web request's report row was refused
-- ("violates check constraint ai_model_requests_platform_check", hundreds of times on 2026-10-19).
-- Additive: the relay already writes 'web'; this lets the rows land.
begin;
alter table public.ai_model_requests drop constraint if exists ai_model_requests_platform_check;
alter table public.ai_model_requests add constraint ai_model_requests_platform_check
  check (platform in ('unknown', 'win32', 'darwin', 'linux', 'web'));
commit;
