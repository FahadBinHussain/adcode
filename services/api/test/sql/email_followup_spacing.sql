begin;
insert into public.users(uid,email,email_verified,status,created_at) values ('mailing-spacing-test','spacing-test@example.invalid',true,'active',1800000000000);
do $$
declare v_now bigint := 1800000000000; v_day bigint := 86400000; j public.email_jobs; n integer;
begin
  perform public.email_set_consent('mailing-spacing-test',true,v_now-15*v_day);
  update public.email_settings set enabled=true,postal_address='Example address in a rolled back test',sender_verified_at=v_now;
  perform public.email_prepare(v_now);
  select * into j from public.email_claim(v_now+10*v_day,10) where uid='mailing-spacing-test';
  assert j.step=0,'initial delayed email must be first';
  update public.email_jobs set status='sent',sent_at=v_now+10*v_day,lease_until=null where id=j.id;
  select count(*) into n from public.email_claim(v_now+11*v_day,10);
  assert n=0,'overdue follow-up must wait four days after actual first send';
  select * into j from public.email_claim(v_now+14*v_day,10) where uid='mailing-spacing-test';
  assert j.step=1,'second email should become eligible after four days';
  update public.email_jobs set status='sent',sent_at=v_now+14*v_day,lease_until=null where id=j.id;
  select count(*) into n from public.email_claim(v_now+15*v_day,10);
  assert n=0,'third email must wait six days after actual second send';
  select * into j from public.email_claim(v_now+20*v_day,10) where uid='mailing-spacing-test';
  assert j.step=2,'third email should become eligible after six days';
  assert public.email_is_eligible(j.id,v_now+20*v_day),'spacing rule must agree at pre-send check';
end $$;
rollback;
select enabled,(select count(*) from public.email_jobs where status='sent') as emails_sent,(select count(*) from public.users) as adcode_accounts from public.email_settings;
