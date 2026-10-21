// Holds the email SQL to its promises, in a real Postgres.
//
// Replays every migration into PGlite (Postgres compiled to WebAssembly), then drives the three
// kinds of mail added on 2026-10-21 - announcements, status updates and report replies - through
// the database functions the API calls: consent and the separate status yes, queueing an
// announcement once per release or incident update, the shared daily budget, retries, the
// status-only unsubscribe, the global unsubscribe, and webhook events finding each kind of send.
//
// No test in `npm run verify` can execute SQL; run this after any change to the email functions.
//
//   node scripts/check-email-sql.mjs .
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const ROOT = process.argv[2] ?? ".";
const MIG = join(ROOT, "supabase/migrations");
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create schema cron;
  create table cron.jobs_seen (name text, schedule text, command text);
  create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ insert into cron.jobs_seen values (a, b, c) returning 1::bigint $$;
`);
for (const name of readdirSync(MIG).filter((n) => n.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(MIG, name), "utf8").replace(/create extension if not exists pg_cron[^;]*;/gi, "");
  try { await db.exec(sql); } catch (error) { console.error(`MIGRATION FAILED: ${name}: ${error.message}`); process.exit(1); }
}
console.log("migrations: all applied");

const T0 = Date.parse("2026-10-21T09:00:00Z");
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;

// Four people: product-only, status-only, both, and one whose address is not verified.
const users = [
  ["u-product", "product@adcode.test", true],
  ["u-status", "status@adcode.test", true],
  ["u-both", "both@adcode.test", true],
  ["u-unverified", "unverified@adcode.test", false],
];
for (const [uid, email, verified] of users) {
  await db.query(`insert into public.users(uid,status,created_at,email,email_verified) values($1,'active',$2,$3,$4)`, [uid, T0, email, verified]);
}
await db.query(`select public.email_set_consent('u-product', true, $1)`, [T0]);
await db.query(`select public.email_set_consent('u-both', true, $1)`, [T0]);
await db.query(`select public.email_set_status_updates('u-status', true, $1)`, [T0]);
await db.query(`select public.email_set_status_updates('u-both', true, $1)`, [T0]);
await assert.rejects(db.query(`select public.email_set_status_updates('u-unverified', true, $1)`, [T0]), /verified-email-required/);
const both = await one(`select subscribed, status_updates, status_consent_at from public.email_preferences where uid='u-both'`);
assert.equal(both.subscribed, true, "ticking status updates leaves the product consent alone");
assert.equal(both.status_updates, true);
assert.equal(Number(both.status_consent_at), T0);
console.log("consent: separate yes for status updates, verified email required");

// Nothing goes out until sending is switched on with a postal address.
const payload = JSON.stringify({ title: "ADCode 2.4.1", summary: "Faster chats.", url: "https://adcode.bluethenics.com/blog" });
assert.equal((await one(`select public.email_announce('product','2.4.1','ADCode 2.4.1 is out',$1::jsonb,'admin-1',$2) as n`, [payload, T0])).n, 2);
assert.equal((await one(`select public.email_announce('product','2.4.1','again',$1::jsonb,'admin-1',$2) as n`, [payload, T0])).n, -1, "one announcement per release");
assert.equal((await one(`select public.email_announce('status','inc-1/upd-1','Free AI outage',$1::jsonb,'admin-1',$2) as n`, [payload, T0])).n, 2);
assert.equal((await all(`select * from public.email_claim_announcements($1, 10)`, [T0])).length, 0, "disabled sending claims nothing");
await db.query(`update public.email_settings set enabled=true, postal_address='1 Example Street, Example City', sender_verified_at=$1`, [T0]);
console.log("announce: product -> subscribed (2), status -> status yes (2), idempotent, held while disabled");

const claimed = await all(`select * from public.email_claim_announcements($1, 10)`, [T0 + 1]);
assert.equal(claimed.length, 4);
assert.deepEqual(claimed.map((row) => `${row.topic}:${row.email}`).sort(), ["product:both@adcode.test", "product:product@adcode.test", "status:both@adcode.test", "status:status@adcode.test"]);
assert.ok(claimed.every((row) => typeof row.unsubscribe_token === "string" && row.subject.length > 0 && row.payload.title === "ADCode 2.4.1"));
assert.equal(Number((await one(`select claimed from public.email_daily_budget`)).claimed), 4, "shares the daily budget");
assert.equal((await all(`select * from public.email_claim_announcements($1, 10)`, [T0 + 2])).length, 0, "a leased job is not claimed twice");

const [first, second, third, fourth] = claimed;
await db.query(`select public.email_finish_announcement($1,'re_1',false,null,$2)`, [first.id, T0 + 3]);
await db.query(`select public.email_finish_announcement($1,null,true,'provider-429',$2)`, [second.id, T0 + 3]);
const retried = await one(`select status, due_at from public.email_announcement_jobs where id=$1`, [second.id]);
assert.equal(retried.status, "pending"); assert.ok(Number(retried.due_at) > T0 + 3, "a retry waits");
await db.query(`select public.email_finish_announcement($1,null,false,'provider-422',$2)`, [third.id, T0 + 3]);
assert.equal((await one(`select status from public.email_announcement_jobs where id=$1`, [third.id])).status, "failed");
console.log("finish: sent keeps the provider id, retryable waits, permanent fails");

// The status email's unsubscribe stops status updates only.
const statusJob = claimed.find((row) => row.topic === "status" && row.email === "status@adcode.test");
await db.query(`select public.email_finish_announcement($1,null,true,'provider-500',$2)`, [fourth.id, T0 + 3]);
await db.query(`select public.email_unsubscribe_status($1,$2)`, [statusJob.unsubscribe_token, T0 + 4]);
const afterStatusOff = await one(`select subscribed, status_updates from public.email_preferences where uid='u-status'`);
assert.equal(afterStatusOff.status_updates, false);
assert.equal((await one(`select count(*)::int as n from public.email_suppressions where email='status@adcode.test'`)).n, 0, "a topic unsubscribe is not a global suppression");
assert.ok((await all(`select status from public.email_announcement_jobs where uid='u-status'`)).every((row) => row.status !== "pending"), "its queued status mail is cancelled");
console.log("unsubscribe: status-only link flips status updates, no suppression");

// Webhooks find announcements and report replies; a bounce suppresses everywhere.
await db.query(`insert into public.reports(report_id,uid,kind,title,body,app_version,platform,status,created_at) values('rep-1','u-both','bug','Broken','It broke','2.3.2','win32','open',$1)`, [T0]);
await db.query(`insert into public.report_replies(reply_id,report_id,author_uid,email,body,provider_id,created_at) values(gen_random_uuid(),'rep-1','admin-1','both@adcode.test','Fixed now','re_reply',$1)`, [T0]);
await db.query(`select public.email_apply_event('evt-1','email.delivered','re_reply',$1)`, [T0 + 5]);
assert.equal(Number((await one(`select delivered_at from public.report_replies where provider_id='re_reply'`)).delivered_at), T0 + 5);
await db.query(`select public.email_apply_event('evt-2','email.delivered','re_1',$1)`, [T0 + 5]);
assert.equal(Number((await one(`select delivered_at from public.email_announcement_jobs where provider_id='re_1'`)).delivered_at), T0 + 5);
const bouncedEmail = first.email;
await db.query(`select public.email_apply_event('evt-3','email.bounced','re_1',$1)`, [T0 + 6]);
assert.equal((await one(`select reason from public.email_suppressions where email=$1`, [bouncedEmail])).reason, "bounce");
const bounced = await one(`select subscribed, status_updates from public.email_preferences where email=$1`, [bouncedEmail]);
assert.equal(bounced.subscribed, false); assert.equal(bounced.status_updates, false);
assert.ok((await all(`select status from public.email_announcement_jobs where email=$1`, [bouncedEmail])).every((row) => !["pending", "sending"].includes(row.status)));
await db.query(`select public.email_apply_event('evt-3','email.bounced','re_1',$1)`, [T0 + 7]);
console.log("webhook: announcement and reply sends found, bounce suppresses all topics, replays ignored");

// The global unsubscribe now stops announcements too.
const productToken = (await one(`select unsubscribe_token from public.email_preferences where uid='u-product'`)).unsubscribe_token;
await db.query(`select public.email_announce('product','2.4.2','ADCode 2.4.2',$1::jsonb,'admin-1',$2)`, [payload, T0 + 8]);
await db.query(`select public.email_unsubscribe($1,$2)`, [productToken, T0 + 9]);
assert.ok((await all(`select j.status from public.email_announcement_jobs j join public.email_announcements a on a.id=j.announcement_id where a.ref='2.4.2' and j.uid='u-product'`)).every((row) => row.status === "cancelled"));
console.log("unsubscribe: the global link cancels queued announcements");

// Model emails are a third separate yes, with their own unsubscribe.
await db.query(`insert into public.users(uid,status,created_at,email,email_verified) values('u-models','active',$1,'models@adcode.test',true)`, [T0]);
await db.query(`select public.email_set_model_updates('u-models', true, $1)`, [T0 + 10]);
await assert.rejects(db.query(`select public.email_set_model_updates('u-unverified', true, $1)`, [T0]), /verified-email-required/);
const modelsPrefs = await one(`select subscribed, status_updates, model_updates, model_consent_at from public.email_preferences where uid='u-models'`);
assert.equal(modelsPrefs.subscribed, false); assert.equal(modelsPrefs.status_updates, false);
assert.equal(modelsPrefs.model_updates, true); assert.equal(Number(modelsPrefs.model_consent_at), T0 + 10);
assert.equal((await one(`select public.email_announce('models','performance:2026-10-21','How the models performed',$1::jsonb,'admin-1',$2) as n`, [payload, T0 + 11])).n, 1, "only the model yes receives model email");
assert.equal((await one(`select public.email_announce('models','performance:2026-10-21','again',$1::jsonb,'admin-1',$2) as n`, [payload, T0 + 11])).n, -1);
const modelJob = (await all(`select * from public.email_claim_announcements($1, 10)`, [T0 + 12])).find((row) => row.topic === "models");
assert.equal(modelJob.email, "models@adcode.test");
await db.query(`select public.email_announce('models','model:glm-5','New model',$1::jsonb,'admin-1',$2)`, [payload, T0 + 13]);
await db.query(`select public.email_unsubscribe_models($1,$2)`, [modelJob.unsubscribe_token, T0 + 14]);
assert.equal((await one(`select model_updates from public.email_preferences where uid='u-models'`)).model_updates, false);
assert.equal((await one(`select count(*)::int as n from public.email_suppressions where email='models@adcode.test'`)).n, 0, "a topic unsubscribe is not a global suppression");
assert.ok((await all(`select j.status from public.email_announcement_jobs j join public.email_announcements a on a.id=j.announcement_id where a.ref='model:glm-5'`)).every((row) => row.status === "cancelled"));
await db.query(`select public.email_set_model_updates('u-models', true, $1)`, [T0 + 15]);
await db.query(`select public.email_unsubscribe($1,$2)`, [modelJob.unsubscribe_token, T0 + 16]);
assert.equal((await one(`select model_updates from public.email_preferences where uid='u-models'`)).model_updates, false, "the global link stops model email too");
console.log("models: separate yes, own unsubscribe, global unsubscribe covers it");

// The included-AI gate's verification claim: once an hour per account.
assert.equal((await one(`select public.claim_verification_send('u-unverified',$1,3600000) as ok`, [T0])).ok, true);
assert.equal((await one(`select public.claim_verification_send('u-unverified',$1,3600000) as ok`, [T0 + 1000])).ok, false);
assert.equal((await one(`select public.claim_verification_send('u-unverified',$1,3600000) as ok`, [T0 + 3600000])).ok, true);
console.log("verification: one send an hour per account");

console.log("email SQL: all checks passed");
