// Holds the free AI credit SQL to the TypeScript rules, in a real Postgres.
//
// Replays every migration into PGlite (Postgres compiled to WebAssembly), then drives the same
// sequence of reservations and settlements through `reserve_included_ai` / `settle_included_ai`
// and through the in-memory store (`services/api/src/tagflowMemoryStore.ts`, which uses
// `credits.ts`), and checks that both answer the same and keep the same windows: a refusal at
// the session limit and at the weekly limit, a window that restarts while a request is still
// running (its late settlement must not land in the new window), and a failed request.
// No test in `npm run verify` can execute SQL; run this after any change to either side.
//
//   npm install --no-save @electric-sql/pglite
//   node scripts/check-credits-sql.mjs .
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const ROOT = process.argv[2] ?? ".";
const MIG = join(ROOT, "supabase/migrations");
const { createTagflowMemoryStore } = await import(pathToFileURL(join(ROOT, "services/api/src/tagflowMemoryStore.ts")).href);

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

const memory = createTagflowMemoryStore();
const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-15T09:00:00Z");
const limits = { dailyRequests: 1_000_000, dailyTokens: 9_000_000_000_000_000, dailyCostMicros: 1_000_000, requestsPerMinute: 1000 };
const plan = { sessionLimit: 5_000, weeklyLimit: 12_000, sessionMs: 5 * HOUR };
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

async function reserve(uid, now, millicredits, tokens = 100) {
  const id = uuid();
  const day = new Date(now).toISOString().slice(0, 10);
  const request = { id, uid, day, minute: Math.floor(now / 60_000), tokens, costMicros: 0, limits, credits: { millicredits, ...plan, now } };
  const fromMemory = await memory.reserveTagflow(request);
  const { rows } = await db.query(
    "select public.reserve_included_ai($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) as r",
    [id, uid, day, request.minute, tokens, 0, limits.dailyRequests, String(limits.dailyTokens), limits.dailyCostMicros, limits.requestsPerMinute, now, millicredits, plan.sessionLimit, plan.weeklyLimit, plan.sessionMs, true],
  );
  assert.equal(rows[0].r, fromMemory, `reserve ${id} at ${new Date(now).toISOString()}: SQL ${rows[0].r}, TypeScript ${fromMemory}`);
  return { id, result: fromMemory };
}

async function settle(id, millicredits, failed = false) {
  const usage = { inputTokens: failed ? 0 : 50, outputTokens: failed ? 0 : 10, costMicros: 0, estimated: false, failed, millicredits };
  await memory.settleTagflow(id, usage);
  await db.query("select public.settle_included_ai($1,$2,$3,$4,$5,$6,$7)", [id, usage.inputTokens, usage.outputTokens, 0, failed ? 0 : millicredits, false, failed]);
}

async function same(uid, label) {
  const mine = await memory.getCreditWindows(uid);
  const { rows } = await db.query("select kind, started_at, ends_at, used_millicredits, reserved_millicredits from public.ai_credit_windows where uid = $1", [uid]);
  const row = (kind) => {
    const found = rows.find((one) => one.kind === kind);
    return found === undefined ? null : { startedAt: Number(found.started_at), endsAt: Number(found.ends_at), usedMillicredits: Number(found.used_millicredits), reservedMillicredits: Number(found.reserved_millicredits) };
  };
  assert.deepEqual({ session: row("session"), week: row("week") }, mine, `${label}: windows differ`);
  console.log(`ok  ${label}`, JSON.stringify(mine));
}

// A session fills up: the request that reaches the limit still runs; the next one is refused.
const a = await reserve("sam", T0, 3_000);
await settle(a.id, 2_500);
const b = await reserve("sam", T0 + HOUR, 3_000);
await settle(b.id, 3_100);
await same("sam", "session overdrawn by its last request");
assert.equal((await reserve("sam", T0 + 2 * HOUR, 10)).result, "session-limit");
await same("sam", "refused at the session limit");

// The window ends and a new one opens with the next request; a request held in the old window
// settles late and must not land in the new one.
const late = await reserve("kim", T0, 1_000);
const fresh = await reserve("kim", T0 + 5 * HOUR, 700);
await settle(late.id, 900);
await settle(fresh.id, 600);
await same("kim", "late settlement left the new session window alone");

// The week fills across sessions; a fresh session cannot get past it.
for (let i = 0; i < 3; i++) {
  const one = await reserve("lee", T0 + i * 6 * HOUR, 4_000);
  assert.equal(one.result, "ok");
  await settle(one.id, 4_000);
}
assert.equal((await reserve("lee", T0 + 18 * HOUR, 10)).result, "weekly-limit");
await same("lee", "refused at the weekly limit with a fresh session");
assert.equal((await reserve("lee", T0 + 7 * 24 * HOUR, 10)).result, "ok");
await same("lee", "a new week opens after seven days");

// A failed request releases what it held and charges nothing.
const failed = await reserve("ana", T0, 2_000);
await settle(failed.id, 0, true);
await same("ana", "a failed request is free");

// A free model (rate zero) opens the windows but never charges or is refused.
await reserve("sam", T0 + 2 * HOUR, 0).then(async ({ id, result }) => { assert.equal(result, "ok"); await settle(id, 0); });
await same("sam", "a zero-rate request runs past the limit");

console.log("credits SQL matches credits.ts");
