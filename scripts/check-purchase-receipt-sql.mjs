import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create schema cron; create table cron.jobs_seen(name text,schedule text,command text);
    create function cron.schedule(a text,b text,c text) returns bigint language sql as 'insert into cron.jobs_seen values(a,b,c) returning 1::bigint';`);
  const before = Date.now();
  for (const name of readdirSync("supabase/migrations").filter(n => n.endsWith(".sql")).sort()) {
    await db.exec(readFileSync("supabase/migrations/" + name, "utf8").replace(/create extension if not exists pg_cron[^;]*;/gi, ""));
  }
  const all = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await all(sql, params))[0];
  const floor = Number((await one("select purchase_receipt_since from email_settings")).purchase_receipt_since);
  assert(floor >= before - 1000 && floor <= Date.now(), "default must not backfill historical buyers");
  const t = Date.parse("2026-10-27T12:00:00Z"), DAY = 86_400_000;
  await db.query("update email_settings set purchase_receipt_since=$1,enabled=false,postal_address='10 Example Road, Example City',sender_verified_at=$1", [t]);
  for (const [uid, verified] of [["plan",true],["tokens",true],["advertiser",true],["unverified",false],["bounced",true],["unsubscribed",true],["stranger",true]]) {
    await db.query("insert into users(uid,status,created_at,email,email_verified,display_name) values($1,'active',$2,$3,$4,$5)", [uid,t,uid+"@example.test",verified,"Buyer "+uid]);
  }
  await db.query("insert into email_suppressions values('bounced@example.test','bounce',$1),('unsubscribed@example.test','unsubscribe',$1)", [t]);
  const sub = async (id,uid,customer="customer_1") => db.query(`insert into ai_subscriptions
    (provider_subscription_id,uid,plan,customer_id,status,ends_at,cancel_at_period_end,updated_at,event_at,event_kind,period_end)
    values($1,$2,'monthly',$3,'active',$4,false,$5,$5,'active',$4)`, [id,uid,customer,t+30*DAY,t]);
  const charge = async (id, { subscription = "sub_plan", order = null, customer = "customer_1", amount = 750, currency = "USD", paid = t, received = t, webhook = "evt_"+id } = {}) => db.query(
    "select email_record_purchase_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id,webhook,subscription,order,customer,amount,currency,paid,received]);
  const prepare = async (at=t) => db.query("select email_prepare_purchase_receipts($1)", [at]);
  const acknowledge = async (job,providerId,retry,code,at) => db.query("select email_finish_purchase_receipt($1,$2,$3,$4,$5,$6)",
    [job.id,job.lease_token,providerId,retry,code,at]);
  const finish = async (job,providerId,retry,code,at) => {
    await acknowledge(job,providerId,retry,code,at);
    if(providerId!==null) await db.query("select email_reconcile_purchase_receipt($1)",[job.id]);
  };
  const payload = async (job,proposed,at) => (await one("select email_purchase_receipt_payload($1,$2,$3,$4) body",
    [job.id,job.lease_token,proposed,at])).body;

  // An active plan alone is not evidence of a paid charge. No seven-day backfill.
  await sub("sub_active_only","plan"); await prepare();
  assert.equal((await one("select count(*)::int n from purchase_receipt_jobs")).n,0);
  await charge("pay_old",{paid:t-1});
  assert.equal((await one("select count(*)::int n from purchase_receipt_payments")).n,0);

  // Actual payment can precede subscription ownership. It is durably retried, not lost.
  await charge("pay_plan"); await prepare();
  assert.equal((await one("select count(*)::int n from purchase_receipt_jobs")).n,0);
  await sub("sub_plan","plan"); await prepare(t+900001);
  let receipt = await one("select * from purchase_receipt_jobs where source_id='pay_plan'");
  assert.equal(receipt.email,"plan@example.test"); assert.equal(receipt.uid,"plan");
  assert.equal(receipt.details.amountMinor,750); assert.equal(receipt.details.currency,"USD");
  assert.equal(receipt.details.subscriptionId,"sub_plan"); assert.equal(receipt.details.planName,undefined);
  await charge("pay_plan",{webhook:"evt_duplicate"}); await prepare(t+900002);
  assert.equal((await one("select count(*)::int n from purchase_receipt_jobs where source_id='pay_plan'")).n,1);

  // Renewals/proration each have a different real payment id even if plan state has changed.
  await charge("pay_renewal",{amount:1080}); await charge("pay_yen",{amount:1500,currency:"JPY"});
  await charge("pay_zero",{amount:0}); await prepare(t+900003);
  assert.equal((await one("select details->>'amountMinor' amount from purchase_receipt_jobs where source_id='pay_renewal'")).amount,"1080");
  assert.equal((await one("select details->>'currency' currency from purchase_receipt_jobs where source_id='pay_yen'")).currency,"JPY");
  assert.equal((await one("select details->>'amountMinor' amount from purchase_receipt_jobs where source_id='pay_zero'")).amount,"0");
  await charge("pay_wrong_customer",{customer:"other_customer"}); await prepare(t+900004);
  assert.equal((await one("select status from purchase_receipt_payments where payment_id='pay_wrong_customer'")).status,"review");
  await charge("pay_conflict"); await prepare(t+900005); await charge("pay_conflict",{amount:999,webhook:"evt_conflict"});
  assert.equal((await one("select status from purchase_receipt_jobs where source_id='pay_conflict'")).status,"cancelled");

  const token = async (id,uid,payment,status="paid") => db.query(`insert into ai_token_orders
    (order_id,uid,pack_id,price_cents,tokens,status,checkout_session,provider_payment_id,created_at,paid_at)
    values($1,$2,'140m',2500,140000000,$3,$4,$5,$6,$6)`, [id,uid,status,"cs_"+id,payment,t]);
  await token("ait_paid","tokens","pay_tokens");
  await charge("pay_tokens",{subscription:null,order:"ait_paid",amount:2700});
  await token("ait_refunded","tokens","pay_refunded","refunded");
  await charge("pay_refunded",{subscription:null,order:"ait_refunded"});
  await token("ait_unverified","unverified","pay_unverified");
  await charge("pay_unverified",{subscription:null,order:"ait_unverified"});
  await prepare(t+900006);
  receipt = await one("select * from purchase_receipt_jobs where source_id='pay_tokens'");
  assert.equal(receipt.details.tokens,140000000); assert.equal(receipt.details.amountMinor,2700);
  assert.equal((await one("select count(*)::int n from purchase_receipt_jobs where source_id in ('pay_refunded','pay_unverified')")).n,0);

  // Billing email must resolve to a verified owner of this exact advertiser.
  await db.query("insert into advertisers(advertiser_id,name,owner_uids,status,funded_micros,reserved_micros,created_at) values('adv','Brand',array['advertiser'],'active',0,0,$1)",[t]);
  const credit = async (id,email,payment) => db.query(`insert into advertiser_credit_orders
    (order_id,advertiser_id,amount_micros,currency,billing_country,customer_email,status,provider_session_id,provider_payment_id,created_at,updated_at)
    values($1,'adv',50000000,'USD','US',$2,'paid',$3,$4,$5,$5)`,[id,email,"cs_"+id,payment,t]);
  await credit("ord_owned","advertiser@example.test","pay_credit");
  await charge("pay_credit",{subscription:null,order:"ord_owned",amount:5500});
  await credit("ord_stranger","stranger@example.test","pay_stranger");
  await charge("pay_stranger",{subscription:null,order:"ord_stranger"}); await prepare(t+900007);
  assert.equal((await one("select email from purchase_receipt_jobs where source_id='pay_credit'")).email,"advertiser@example.test");
  assert.equal((await one("select count(*)::int n from purchase_receipt_jobs where source_id='pay_stranger'")).n,0);

  await sub("sub_bounce","bounced"); await sub("sub_unsubscribe","unsubscribed");
  await charge("pay_bounce",{subscription:"sub_bounce"}); await charge("pay_unsubscribe",{subscription:"sub_unsubscribe"});
  await prepare(t+900008);
  assert.equal((await one("select count(*)::int n from purchase_receipt_jobs where source_id='pay_bounce'")).n,0);
  assert(await one("select * from purchase_receipt_jobs where source_id='pay_unsubscribe'"));

  // Stable leases, provider reconciliation and suppression before/after provider acknowledgement.
  let jobs = await all("select * from email_claim_purchase_receipts($1,10)",[t+900009]);
  assert(jobs.length>0 && jobs.length<=10);
  assert(jobs.every(j=>Number(j.due_at)===t+900009+600000 && j.lease_token),"active leases must leave the due index range");
  assert.equal((await all("select * from email_claim_purchase_receipts($1,10)",[t+900010])).length,0);
  receipt = jobs.find(j=>j.source_id==="pay_plan");
  const mail={from:"ADCode <adcode@example.test>",reply_to:"adcode@example.test",to:[receipt.email],subject:"Original receipt",html:"<p>Original</p>",text:"Original",tags:[{name:"campaign",value:"purchase-receipt"}]};
  assert.equal(await payload(receipt,null,t+900010),null);
  assert.deepEqual(await payload(receipt,mail,t+900010),mail);
  assert.deepEqual(await payload(receipt,{...mail,subject:"Changed after deployment"},t+900010),mail,"first payload is immutable");
  assert.deepEqual(await payload(receipt,null,t+900010),mail);
  assert.equal(await payload({...receipt,lease_token:"00000000-0000-4000-8000-000000000099"},mail,t+900010),null,"a stale claimant cannot obtain a send payload");
  const freeJob=jobs.find(j=>j.source_id==="pay_zero");
  await assert.rejects(payload(freeJob,{...mail,to:["not-the-owner@example.test"]},t+900010),/Invalid receipt provider payload/);
  await db.query("select email_apply_event('early','email.delivered','resend_1',$1)",[t+900011]);
  await acknowledge(receipt,"resend_1",false,null,t+900012);
  await db.query(`do $$ begin begin perform public.email_reconcile_purchase_receipt('${receipt.id}'::uuid);
    raise exception 'simulated reconciliation transport failure'; exception when others then null; end; end $$`);
  let ack=await one("select provider_id,needs_reconcile,delivered_at from purchase_receipt_jobs where id=$1",[receipt.id]);
  assert.deepEqual(ack,{provider_id:"resend_1",needs_reconcile:true,delivered_at:null},"ACK remains committed after reconciliation rollback");
  await prepare(t+900012);
  assert.equal(Number((await one("select delivered_at from purchase_receipt_jobs where id=$1",[receipt.id])).delivered_at),t+900011);
  assert.equal((await one("select needs_reconcile from purchase_receipt_jobs where id=$1",[receipt.id])).needs_reconcile,false);
  const bounced = jobs.find(j=>j.source_id==="pay_tokens");
  await db.query("select email_apply_event('early_bounce','email.bounced','resend_bounce',$1)",[t+900013]);
  await finish(bounced,"resend_bounce",false,null,t+900014);
  assert.equal((await one("select reason from email_suppressions where email='tokens@example.test'")).reason,"bounce");
  await finish(bounced,"resend_bounce",false,null,t+900015);
  assert.deepEqual(await one("select status,last_error from purchase_receipt_jobs where id=$1",[bounced.id]),{status:"cancelled",last_error:"provider-email-bounced"});
  const failed=jobs.find(j=>j.source_id==="pay_renewal"),suppressed=jobs.find(j=>j.source_id==="pay_yen");
  await db.query("select email_apply_event('early_failed','email.failed','resend_failed',$1)",[t+900014]);
  await finish(failed,"resend_failed",false,null,t+900015);
  assert.deepEqual(await one("select status,last_error from purchase_receipt_jobs where id=$1",[failed.id]),{status:"failed",last_error:"provider-email-failed"});
  await finish(failed,"resend_failed",false,null,t+900016);
  assert.equal((await one("select status from purchase_receipt_jobs where id=$1",[failed.id])).status,"failed","duplicate accepted acknowledgement preserves provider failure");
  await db.query("select email_apply_event('later_delivered','email.delivered','resend_failed',$1)",[t+900017]);
  await db.query("select email_apply_event('stale_failed','email.failed','resend_failed',$1)",[t+900018]);
  assert.deepEqual(await one("select status,last_error from purchase_receipt_jobs where id=$1",[failed.id]),{status:"sent",last_error:null},"definitive delivery proof wins over out-of-order failure events");
  await db.query("select email_apply_event('early_suppressed','email.suppressed','resend_suppressed',$1)",[t+900014]);
  await finish(suppressed,"resend_suppressed",false,null,t+900015);
  await finish(suppressed,"resend_suppressed",false,null,t+900016);
  assert.deepEqual(await one("select status,last_error from purchase_receipt_jobs where id=$1",[suppressed.id]),{status:"cancelled",last_error:"provider-email-suppressed"});
  assert.equal((await one("select count(*)::int n from email_suppressions where email='plan@example.test'")).n,0,"provider suppression must not invent a bounce or complaint reason");
  const retry = jobs.find(j=>j.source_id==="pay_credit");
  await finish(retry,null,true,"provider-429",t+900015);
  const due=Number((await one("select due_at from purchase_receipt_jobs where id=$1",[retry.id])).due_at);
  const reclaimed=await all("select * from email_claim_purchase_receipts($1,10)",[due]);
  assert(reclaimed.some(j=>j.id===retry.id));
  const newLease=await one("select lease_token,status,due_at from purchase_receipt_jobs where id=$1",[retry.id]);
  await finish(retry,null,true,"stale-failure",due+1);
  assert.deepEqual(await one("select lease_token,status,due_at from purchase_receipt_jobs where id=$1",[retry.id]),newLease,"a stale failure cannot release another worker's lease");
  await db.query("update purchase_receipt_jobs set first_attempt_at=$1,lease_until=$2,due_at=$2 where id=$3",[due-82800001,due-1,retry.id]);
  await db.query("select * from email_claim_purchase_receipts($1,10)",[due+1]);
  assert.equal((await one("select status from purchase_receipt_jobs where id=$1",[retry.id])).status,"failed");
  const changed = jobs.find(j=>j.source_id==="pay_unsubscribe");
  await db.query("update users set email='changed@example.test' where uid='unsubscribed'");
  assert.equal((await one("select email_purchase_receipt_eligible($1,$2,$3) ok",[changed.id,changed.lease_token,t+900020])).ok,false);

  // A burst progresses in bounded indexed pages; campaign budgets are untouched.
  await db.query("insert into email_daily_budget(day,claimed) values('2026-10-27',50) on conflict(day) do update set claimed=50");
  await db.query("update purchase_receipt_payments set retry_at=$1 where status='pending'",[t+3*DAY]);
  await db.query(`insert into purchase_receipt_payments(payment_id,webhook_id,subscription_id,customer_id,amount_minor,currency,paid_at,received_at,retry_at)
    select 'burst_'||n,'burst_evt_'||n,'sub_plan','customer_1',900,'USD',$1,$1,$1 from generate_series(1,250) n`,[t+2*DAY]);
  await prepare(t+2*DAY);
  assert.equal((await one("select count(*)::int n from purchase_receipt_jobs where source_id like 'burst_%'")).n,100);
  await prepare(t+2*DAY);
  assert.equal((await one("select count(*)::int n from purchase_receipt_jobs where source_id like 'burst_%'")).n,200);
  await prepare(t+2*DAY);
  assert.equal((await one("select count(*)::int n from purchase_receipt_jobs where source_id like 'burst_%'")).n,250);
  jobs=await all("select * from email_claim_purchase_receipts($1,1000)",[t+2*DAY]); assert.equal(jobs.length,10);
  assert.equal(Number((await one("select claimed from email_daily_budget where day='2026-10-27'")).claimed),50);
  await db.exec("set enable_seqscan=off");
  const plan=(await all("explain(costs off) select payment_id from purchase_receipt_payments where status='pending' and retry_at<=$1 order by retry_at,payment_id limit 100",[t+2*DAY])).map(r=>r["QUERY PLAN"]).join("\n");
  assert.match(plan,/purchase_receipt_payment_due_idx/);
  const claimPlan=(await all("explain(costs off) select id from purchase_receipt_jobs where due_at<=$1 and (status='pending' or status='sending' and lease_until<$1) order by due_at,id limit 100",[t+2*DAY])).map(r=>r["QUERY PLAN"]).join("\n");
  assert.match(claimPlan,/purchase_receipt_due_idx/);
  const reconcilePlan=(await all("explain(costs off) select id from purchase_receipt_jobs where needs_reconcile and provider_id is not null order by id limit 100")).map(r=>r["QUERY PLAN"]).join("\n");
  assert.match(reconcilePlan,/purchase_receipt_reconcile_idx/);
  assert.equal((await one("select has_table_privilege('anon','purchase_receipt_payments','select') ok")).ok,false);
  assert.equal((await one("select has_function_privilege('anon','email_prepare_purchase_receipts(bigint)','execute') ok")).ok,false);
  console.log("Purchase receipt SQL: signed-charge identity, ownership, exact amounts, future-only floor, bounded queues, retries and delivery checks passed");
} finally { await db.close(); }
