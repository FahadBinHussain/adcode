// Holds the AI plans SQL to its promises, in a real Postgres.
//
// Replays every migration into PGlite, then drives the plan functions (20261024140000) the way the
// relay, the Dodo webhook and the admin routes call them: subscriptions applied once and lasting
// until their period end, gifts and boosts for one person or everyone, promo codes (limit, expiry,
// once per account), Pro invites rewarded once, week resets, and the subscriber summary.
//
// No test in npm run verify can execute SQL; run this after any change to these functions.
//
//   node scripts/check-ai-plans-sql.mjs .
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

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
const DAY = 86_400_000;
const sub = (webhook, type, subscription, uid, plan, periodEnd = 30 * DAY, now = DAY) =>
  one(`select public.apply_ai_subscription_event($1,$2,$3,$4,$5,'cus_1','active',$6,false,$7) r`, [webhook, type, subscription, uid, plan, periodEnd, now]).then((row) => row.r);
const state = (uid, now) => one(`select * from public.ai_plan_state($1,$2)`, [uid, now]);
const purchased = async (uid) => Number((await one(`select coalesce((select purchased from public.ai_token_balances where uid=$1),0) n`, [uid])).n);

// Subscriptions: once, until the period end; cancelled keeps access; failed ends it; no uid -> review.
assert.equal(await sub("wh1", "active", "sub_1", "u", "monthly"), "applied");
assert.equal(await sub("wh1", "active", "sub_1", "u", "monthly"), "duplicate");
assert.equal((await state("u", 2 * DAY)).plan, "monthly");
assert.equal((await state("u", 31 * DAY)).plan, null);
assert.equal(await sub("wh2", "cancelled", "sub_1", "u", "monthly", 30 * DAY, 2 * DAY), "applied");
assert.equal((await state("u", 3 * DAY)).plan, "monthly");
assert.equal(await sub("wh3", "failed", "sub_1", "u", "monthly", 30 * DAY, 4 * DAY), "applied");
assert.equal((await state("u", 5 * DAY)).plan, null);
assert.equal(await sub("wh4", "active", "sub_x", null, "monthly"), "review");
assert.equal(await sub("wh5", "active", "sub_y", "u", null), "review");
assert.equal((await one(`select count(*)::int n from public.provider_events where status='review_required' and event_type like 'ai-sub-%'`)).n, 2);
console.log("subscriptions: once, until period end, review without uid");

// Gifts and boosts, one person or everyone; the best plan wins.
await q(`insert into public.ai_plan_gifts(uid, plan, starts_at, ends_at, source, created_at) values ('*','weekly',0,$1,'admin',0)`, [7 * DAY]);
await q(`insert into public.ai_boosts(uid, weekly_tokens, starts_at, ends_at, created_by) values ('g',90000000,0,$1,'admin')`, [3 * DAY]);
const other = await state("other", DAY);
assert.equal(other.plan, "weekly");
assert.equal(other.source, "gift");
assert.equal(Number(other.boost_tokens), 0);
assert.equal(Number((await state("g", DAY)).boost_tokens), 90000000);
assert.equal((await state("g", 8 * DAY)).plan, null);
await sub("wh6", "active", "sub_p0", "best", "pro");
assert.equal((await state("best", DAY)).plan, "pro", "pro beats everyone's weekly gift");
console.log("gifts and boosts: best one wins, everyone rows apply to all");

// Promo codes.
await q(`insert into public.ai_promo_codes(code, kind, tokens, max_redemptions, expires_at, created_by, created_at) values ('ONE','tokens',5,1,$1,'admin',0)`, [10 * DAY]);
const promo = async (code, uid, now) => (await one(`select public.redeem_ai_promo($1,$2,$3) r`, [code, uid, now])).r;
assert.equal(await promo("ONE", "a", DAY), "tokens");
assert.equal(await promo("ONE", "a", DAY), "already");
assert.equal(await promo("ONE", "b", DAY), "used-up");
assert.equal(await promo("NOPE", "b", DAY), "unknown");
assert.equal(await purchased("a"), 5);
await q(`insert into public.ai_promo_codes(code, kind, plan, days, max_redemptions, expires_at, created_by, created_at) values ('PRO7','plan','pro',7,5,$1,'admin',0)`, [3 * DAY]);
assert.equal(await promo("PRO7", "c", 4 * DAY), "expired");
assert.equal(await promo("PRO7", "d", DAY), "plan");
assert.equal((await state("d", 2 * DAY)).source, "gift");
const race = await Promise.all(["r1", "r2", "r3", "r4", "r5"].map((uid) => promo("PRO7", uid, DAY)));
assert.deepEqual(race.sort(), ["plan", "plan", "plan", "plan", "used-up"]);
console.log("promo codes: limit, expiry, once per account");

// Pro invites: rewarded once per invitee.
await sub("whp", "active", "sub_p", "pro1", "pro");
const invite = await one(`select * from public.ai_invite_for('pro1',$1)`, [DAY]);
assert.equal(invite.uses, 0);
assert.equal(invite.max_uses, 2);
assert.equal((await one(`select * from public.ai_invite_for('pro1',$1)`, [DAY])).code, invite.code);
assert.equal(await one(`select * from public.ai_invite_for('nopro',$1)`, [DAY]), undefined);
const redeem = async (uid) => (await one(`select public.redeem_ai_invite($1,$2,$3) r`, [invite.code, uid, DAY])).r;
assert.equal(await redeem("pro1"), "own-code");
assert.equal(await redeem("friend"), "joined");
assert.equal(await redeem("friend"), "already");
await sub("whf1", "active", "sub_f", "friend", "monthly");
await sub("whf2", "cancelled", "sub_f", "friend", "monthly", 30 * DAY, 2 * DAY);
await sub("whf3", "active", "sub_f2", "friend", "monthly");
assert.equal(await purchased("friend"), 4000000);
assert.equal(await purchased("pro1"), 4000000);
await sub("whx", "active", "sub_x2", "paying", "monthly");
assert.equal(await redeem("paying"), "has-plan");
assert.equal(await redeem("second"), "joined");
assert.equal(await redeem("third"), "used-up");
console.log("invites: rewarded once, two uses");

// Week reset.
const MAX = "9223372036854775807";
assert.equal((await one(`select public.reset_ai_week('w') r`)).r, "none");
await q(`select public.reserve_ai_with_tokens('00000000-0000-0000-0000-000000000051'::uuid,'w','2026-10-24'::date,1,10,0,0,${MAX},${MAX},0,1,0,0,0,18000000,false,true,100)`);
assert.equal((await one(`select public.reset_ai_week('w') r`)).r, "busy");
await q(`select public.settle_included_ai('00000000-0000-0000-0000-000000000051'::uuid,10,0,0,0,false,false)`);
assert.deepEqual((await q(`select uid from public.ai_credit_windows where kind='paid_week' and uid > '' order by uid limit 10`)).map((row) => row.uid), ["w"]);
assert.equal((await one(`select public.reset_ai_week('w') r`)).r, "reset");
assert.equal((await one(`select count(*)::int n from public.ai_credit_windows where uid='w' and kind='paid_week'`)).n, 0);
console.log("week reset: refused while held, then fresh");

// Summary and indexes.
const summary = await q(`select * from public.ai_subscription_summary($1)`, [2 * DAY]);
assert.ok(summary.some((row) => row.plan === "pro" && Number(row.active) >= 1 && Number(row.mrr_cents) >= 1900));
await q(`insert into public.ai_subscriptions(provider_subscription_id, uid, plan, status, ends_at, updated_at) select 'bulk'||g, 'bulk'||g, 'monthly', 'active', 99, 0 from generate_series(1,1000) g`);
await q(`analyze public.ai_subscriptions`);
const explained = (await q(`explain select 1 from public.ai_subscriptions where uid = 'u' and ends_at > 5`)).map((row) => row["QUERY PLAN"]).join("\n");
assert.ok(!/Seq Scan on ai_subscriptions/.test(explained), `the plan lookup must use an index:\n${explained}`);
console.log("summary and indexes: as expected");

console.log("AI plans SQL: all checks passed");
