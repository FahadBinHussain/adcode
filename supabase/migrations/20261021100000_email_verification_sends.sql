-- Free AI asks for a verified email, and GitHub and email/password sign-ins arrive unverified with
-- no screen anywhere that sent a verification link: on 2026-10-20, 11 of 15 people who reported
-- "Sign in to use free AI" were signed in and could never get past it. The included-AI gate now
-- sends Firebase's own verification email itself. This table is how it sends at most one a day per
-- account, across every Worker isolate at once.
begin;

create table if not exists public.email_verification_sends (
  uid text primary key,
  sent_at bigint not null
);
alter table public.email_verification_sends enable row level security;
revoke all on public.email_verification_sends from anon, authenticated;
grant all on public.email_verification_sends to service_role;

-- True when this call may send: there was no send for the account, or the last one is at least
-- p_gap_ms old. The upsert's WHERE makes the check and the claim one atomic step.
create or replace function public.claim_verification_send(p_uid text, p_now bigint, p_gap_ms bigint) returns boolean
language plpgsql volatile security invoker set search_path = '' as $$
declare
  claimed text;
begin
  insert into public.email_verification_sends as sends (uid, sent_at) values (p_uid, p_now)
  on conflict (uid) do update set sent_at = excluded.sent_at
  where sends.sent_at <= p_now - p_gap_ms
  returning sends.uid into claimed;
  return claimed is not null;
end;
$$;
revoke all on function public.claim_verification_send(text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.claim_verification_send(text, bigint, bigint) to service_role;

commit;
