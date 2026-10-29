import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table users(uid text primary key,status text,created_at bigint);
    create table sightings(uid text,at bigint);
    create function growth_sightings() returns table(uid text,at bigint) language sql as 'select * from public.sightings';
    create table receipts(cost_micros bigint,credited_micros bigint,outcome text,created_at bigint);
    create table withdrawals(status text,amount_micros bigint,decided_at bigint);
    grant select on all tables in schema public to service_role;
    grant execute on function growth_sightings() to service_role;`);
  await db.exec(readFileSync("supabase/migrations/20261024180421_analytics_day_comparisons.sql", "utf8"));
  const at = Date.parse("2026-10-23T12:00:00Z"), d = 86400000;
  await db.query("insert into users values ('old','active',$1),('new','active',$2),('future','active',$3)", [at-40*d,at-1000,at+1]);
  await db.query("insert into sightings values ('old',$1),('old',$2),('new',$3),('future',$4)", [at-40*d,at-1000,at,at+1]);
  await db.query("insert into receipts values (100,50,'impression',$1),(100,50,'click',$1),(0,0,'impression',$1),(100,50,'impression',$2)", [at,at+1]);
  await db.query("insert into withdrawals values ('paid',1000000,$1),('paid',2000000,$2),('requested',4000000,$1)", [at,at+1]);
  const read = async () => (await db.query("select read_growth_day_baseline($1) as data", [at])).rows[0].data;
  assert.deepEqual(await read(), { developers: 2,active1d:2,active7d:2,active30d:2,returning7d:1,adsShown:1,creditedMicros:"100",paidOutMicros:"1000000" });
  for (const role of ["anon","authenticated"]) {
    await db.exec(`set role ${role}`); await assert.rejects(read(), /permission denied/); await db.exec("reset role");
  }
  await db.exec("set role service_role"); assert.equal((await read()).developers,2);
  console.log("Analytics comparison SQL passed: timestamp boundaries, future exclusions, distinct windows, money, and private access.");
} finally { await db.close(); }
