import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create schema cron; create table cron.jobs_seen(name text,schedule text,command text);
    create function cron.schedule(a text,b text,c text) returns bigint language sql as 'insert into cron.jobs_seen values(a,b,c) returning 1::bigint';`);
  for (const name of readdirSync("supabase/migrations").filter(n=>n.endsWith(".sql")).sort()) {
    await db.exec(readFileSync("supabase/migrations/"+name,"utf8").replace(/create extension if not exists pg_cron[^;]*;/gi,""));
  }
  const t = Date.parse("2026-10-24T18:00:00Z");
  const one = async (sql,params=[]) => (await db.query(sql,params)).rows[0];
  const all = async (sql,params=[]) => (await db.query(sql,params)).rows;
  await db.query("update email_settings set advertiser_welcome_since=$1,enabled=false,postal_address='10 Example Road, Example City',sender_verified_at=$1",[t]);
  for(const [uid,verified] of [["fresh",true],["unverified",false],["suppressed",true],["second",true],["retry",true],["future",true]]) {
    await db.query("insert into users(uid,status,created_at,email,email_verified) values($1,'active',$2,$3,$4)",[uid,t,uid+"@example.test",verified]);
  }
  const advertiser = async (id,uid,at) => db.query("insert into advertisers(advertiser_id,name,owner_uids,status,created_at) values($1,$1,array[$2],'active',$3)",[id,uid,at]);
  await advertiser("old","fresh",t-1); await advertiser("fresh","fresh",t+1);
  await advertiser("unverified","unverified",t+1); await advertiser("suppressed","suppressed",t+1); await advertiser("future","future",t+1000000);
  await db.query("insert into email_suppressions values('suppressed@example.test','unsubscribe',$1)",[t]);
  await db.query("select email_prepare_advertiser_welcomes($1)",[t+2]); await db.query("select email_prepare_advertiser_welcomes($1)",[t+2]);
  assert.equal((await one("select count(*) as n from advertiser_welcome_jobs")).n,1);
  assert.equal((await all("select * from email_claim_advertiser_welcomes($1,10)",[t+2])).length,0);
  await db.exec("update email_settings set enabled=true");
  const [first] = await all("select * from email_claim_advertiser_welcomes($1,10)",[t+3]); assert(first);
  assert.equal((await all("select * from email_claim_advertiser_welcomes($1,10)",[t+3])).length,0);
  assert.equal((await one("select email_advertiser_welcome_eligible($1,$2) as ok",[first.id,t+3])).ok,true);
  // Webhooks may arrive before the sender has recorded the provider's receipt.
  await db.query("select email_apply_event('welcome-early','email.delivered','welcome-1',$1)",[t+4]);
  await db.query("select email_finish_advertiser_welcome($1,'welcome-1',false,null,$2)",[first.id,t+5]);
  assert.equal((await one("select delivered_at from advertiser_welcome_jobs where id=$1",[first.id])).delivered_at,t+4);
  await db.query("select email_prepare_advertiser_welcomes($1)",[t+6]);
  assert.equal((await one("select count(*) as n from advertiser_welcome_jobs")).n,1);
  // Changed account addresses are never used from a stale queue snapshot.
  await advertiser("second","second",t+6); await db.query("select email_prepare_advertiser_welcomes($1)",[t+7]);
  const [second] = await all("select * from email_claim_advertiser_welcomes($1,10)",[t+8]);
  await db.exec("update users set email='changed@example.test' where uid='second'");
  assert.equal((await one("select email_advertiser_welcome_eligible($1,$2) as ok",[second.id,t+8])).ok,false);
  await db.exec("update users set email='second@example.test' where uid='second'");
  await db.query("select email_apply_event('welcome-bounce','email.bounced','welcome-2',$1)",[t+9]);
  await db.query("select email_finish_advertiser_welcome($1,'welcome-2',false,null,$2)",[second.id,t+10]);
  assert.equal((await one("select reason from email_suppressions where email='second@example.test'")).reason,"bounce");
  await advertiser("retry","retry",t+11); await db.query("select email_prepare_advertiser_welcomes($1)",[t+12]);
  const [retry] = await all("select * from email_claim_advertiser_welcomes($1,10)",[t+13]);
  await db.query("select email_finish_advertiser_welcome($1,null,true,'provider-429',$2)",[retry.id,t+14]);
  assert.equal((await all("select * from email_claim_advertiser_welcomes($1,10)",[t+15])).length,0);
  const due = Number((await one("select due_at from advertiser_welcome_jobs where id=$1",[retry.id])).due_at);
  assert.equal((await all("select * from email_claim_advertiser_welcomes($1,10)",[due])).length,1);
  await db.query("update advertiser_welcome_jobs set first_attempt_at=$1,lease_until=$2 where id=$3",[t-82800001,t,retry.id]);
  await db.query("select * from email_claim_advertiser_welcomes($1,10)",[due+1]);
  assert.equal((await one("select status from advertiser_welcome_jobs where id=$1",[retry.id])).status,"failed");
  // Welcome mail shares the existing campaign budget rather than exceeding it.
  for (let i=0;i<3;i++) await advertiser("budget-"+i,"fresh",t+20+i);
  await db.query("select email_prepare_advertiser_welcomes($1)",[t+30]);
  await db.exec("update email_daily_budget set claimed=49");
  assert.equal((await all("select * from email_claim_advertiser_welcomes($1,10)",[t+31])).length,1);
  assert.equal((await all("select * from email_claim_advertiser_welcomes($1,10)",[t+32])).length,0);
  for (const role of ["anon","authenticated"]) {
    await db.exec(`set role ${role}`); await assert.rejects(db.query("select email_prepare_advertiser_welcomes($1)",[t+40]),/permission denied/); await db.exec("reset role");
  }
  console.log("Advertiser welcome SQL passed: new workspaces only, once each, verified accounts, suppressions, leases, recipient changes, retry expiry, shared budget, early delivery/bounce events, and private access. No emails sent.");
} finally { await db.close(); }
