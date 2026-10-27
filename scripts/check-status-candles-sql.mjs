// Verify real Postgres aggregation, rolling recovery, boundaries and access control.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
try {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(readFileSync("supabase/migrations/20261011141750_free_model_provider_reports.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261024142631_model_status_candles.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261024165153_live_status_recovery_window.sql", "utf8"));
  const to = Date.parse("2026-10-24T14:45:00Z");
  const hour = 3_600_000;
  const from = Date.parse("2026-10-17T16:00:00Z");
  const fields = ["id", "uid", "model_id", "model_name", "provider", "upstream_model", "started_at", "outcome", "error_code", "source", "streamed", "tools_offered", "context_window", "requested_output", "estimated_input", "duration_ms"];
  const base = { id: randomUUID(), uid: "PRIVATE-UID", model_id: "coder", model_name: "Coder", provider: "tagflow", upstream_model: "coder", started_at: to - 10_000, outcome: "success", error_code: null, source: "chat", streamed: true, tools_offered: true, context_window: 131072, requested_output: 4096, estimated_input: 100, duration_ms: 2000 };
  const insert = async (over) => {
    const row = { ...base, id: randomUUID(), ...over };
    await db.query(`insert into public.ai_model_requests (${fields.join(",")}) values (${fields.map((_, i) => `$${i + 1}`).join(",")})`, fields.map(key => row[key]));
  };
  await insert({ started_at: from }); // First candle's inclusive start.
  await insert({ started_at: from - 1 });
  await insert({ started_at: to }); // Read's exclusive end.
  await insert({ started_at: to - 2 * hour, outcome: "provider_error", error_code: "upstream-rate-limit" });
  await insert({ started_at: to - 2 * hour - 1, outcome: "provider_error", error_code: "upstream-rate-limit" });
  await insert({ started_at: to - 15 * 60_000, outcome: "provider_error", error_code: "upstream-rate-limit" });
  await insert({ started_at: to - 15 * 60_000 - 1, outcome: "provider_error", error_code: "upstream-rate-limit" });
  await insert({ outcome: "rejected", error_code: "model-busy" });
  await insert({ outcome: "relay_error", error_code: "storage-or-relay" });
  for (const [outcome, code] of [["rejected", "images-not-supported"], ["rejected", "context-length"], ["rejected", "credits"], ["cancelled", null], ["pending", null]]) {
    await insert({ outcome, error_code: code });
  }
  await insert({ source: "admin-test", outcome: "provider_error" });
  // More than PostgREST's default 1,000-row limit: aggregation must happen in SQL.
  await db.query(`insert into public.ai_model_requests (${fields.join(",")}) select ${fields.map(key => key === "id" ? "gen_random_uuid()" : `r.${key}`).join(",")} from public.ai_model_requests r cross join generate_series(1,1205) where r.id = $1`, [
    (await db.query("select id from public.ai_model_requests where started_at = $1", [from])).rows[0].id,
  ]);
  const read = async () => (await db.query("select public.read_model_status_buckets($1,$2) as data", [from, to])).rows[0].data;
  const rows = await read();
  assert.equal(rows.reduce((sum, row) => sum + row.count, 0), 1212);
  assert.equal(rows.filter(row => row.outcome === "error").reduce((sum, row) => sum + row.count, 0), 6);
  assert.equal(rows.reduce((sum, row) => sum + row.recentCount, 0), 3);
  assert.equal(rows.find(row => row.startAt === from).count, 1206);
  assert(rows.every(row => row.startAt % (2 * hour) === 0));
  assert(!JSON.stringify(rows).includes("PRIVATE-UID"));
  assert(!JSON.stringify(rows).includes("upstream-rate-limit"));
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(read(), /permission denied/);
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  assert.deepEqual(await read(), rows);
  console.log("Status candles SQL passed: 2-hour boundaries, rolling sample, 1,000+ requests, capacity errors, client-error exclusions, privacy and server-only access.");
} finally {
  await db.close();
}
